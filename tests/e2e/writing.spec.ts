import { expect, test, type Page } from "@playwright/test";
import {
  addChild,
  admin,
  answerQuestion,
  lessonQuestions,
  passParentGate,
  registerParent,
  startLesson,
  waitForSynced,
} from "./helpers";

// Phase 8 vertical slice, with real content from the database: parent → child → Writing →
// the writing workshop (trace a letter, write a letter, build a word, write a word, build a
// sentence, write a sentence) → a wrong try gets the writing checklist and a retry → the
// server re-checks and stores every answer with its writing analysis → skill mastery and
// the review queue → the parent sees the writing report with the child's own sentence.

const section = (page: Page) => page.locator("section[data-question-id]");

async function currentQuestionId(page: Page) {
  const finished = page.getByRole("heading", { level: 1, name: /You finished/ });
  await finished.or(section(page)).first().waitFor();
  if (await finished.isVisible()) return null;
  return section(page).getAttribute("data-question-id");
}

test("a child writes letters, words and sentences, fixes a mistake, and the parent sees it", async ({
  page,
}) => {
  await registerParent(page);
  const childId = await addChild(page, "Wren", /Kindergarten 3/);
  await page.getByRole("button", { name: /Start learning as Wren/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);

  // Child home → Writing.
  await page
    .getByRole("link", { name: /Writing/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/child\/writing$/);
  await expect(page.getByRole("heading", { name: /Write/ }).first()).toBeVisible();

  const { lessonId, questions } = await lessonQuestions("kg3-writing-workshop");
  await page.getByRole("link", { name: /Writing workshop/ }).click();
  await expect(page).toHaveURL(new RegExp(`/child/learn/${lessonId}$`));
  await startLesson(page);

  const seen: string[] = [];
  const mistakes = new Set(["TRACING", "SENTENCE_WRITING"]);
  for (let guard = 0; guard < 30; guard++) {
    const id = await currentQuestionId(page);
    if (!id) break;
    const q = questions.get(id)!;
    seen.push(q.question_type);
    if (mistakes.has(q.question_type)) {
      mistakes.delete(q.question_type);
      // A wrong first try: the checklist names what to fix; the child tries again.
      await answerQuestion(page, q, false);
      await expect(page.getByTestId("writing-feedback")).toBeVisible();
      await expect(page.getByTestId("writing-feedback")).toContainText(/not yet/);
      await page.getByRole("button", { name: "Try again" }).click();
    }
    await answerQuestion(page, q, true);
    await expect(page.getByRole("status").filter({ hasText: /Next/ }).first()).toBeVisible();
    await page.getByRole("button", { name: /^Next/ }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: /You finished/ })).toBeVisible();
  expect(seen).toEqual([
    "TRACING",
    "TRACING",
    "WORD_BUILDER",
    "SPELLING",
    "SENTENCE_BUILDER",
    "SENTENCE_WRITING",
  ]);
  await waitForSynced(page);

  // Stored once each, judged on the server: strokes and the sentence with their analysis.
  const { data: attempts } = await admin
    .from("activity_attempts")
    .select("question_type, attempt_number, is_correct, response, writing_analysis, skill_id")
    .eq("child_id", childId)
    .order("attempted_at");
  expect(attempts!.length).toBe(8);
  const tracing = attempts!.filter((a) => a.question_type === "TRACING");
  expect(tracing.map((a) => [a.attempt_number, a.is_correct])).toEqual([
    [1, false],
    [2, true],
    [1, true],
  ]);
  expect(tracing[1].writing_analysis).toMatchObject({
    kind: "trace",
    trace: { glyph: "upper-f", method: "draw" },
  });
  const sentence = attempts!.filter((a) => a.question_type === "SENTENCE_WRITING");
  expect(sentence.map((a) => a.is_correct)).toEqual([false, true]);
  const text = (sentence[1].response as { value: string }).value;
  expect(sentence[1].writing_analysis).toMatchObject({ kind: "rubric" });
  expect(
    attempts!.every(
      (a) =>
        a.question_type === "SENTENCE_BUILDER" ||
        a.question_type === "SPELLING" ||
        a.question_type === "WORD_BUILDER" ||
        a.writing_analysis,
    ),
  ).toBe(true);

  // Progress, mastery and review from the stored answers.
  const skillId = sentence[1].skill_id;
  await expect
    .poll(
      async () =>
        (
          await admin
            .from("lesson_progress")
            .select("status")
            .eq("child_id", childId)
            .eq("lesson_id", lessonId)
            .maybeSingle()
        ).data?.status,
    )
    .toBe("COMPLETED");
  const { data: mastery } = await admin
    .from("skill_mastery")
    .select("status, attempts")
    .eq("child_id", childId)
    .eq("skill_id", skillId)
    .single();
  expect(mastery!.attempts).toBeGreaterThan(0);
  const { data: review } = await admin
    .from("review_items")
    .select("item_key, status")
    .eq("child_id", childId)
    .eq("item_key", `skill:${skillId}`);
  expect(review!.length).toBe(1);

  // The child's writing home shows their latest writing.
  await page.goto("/child/writing");
  await expect(page.getByRole("heading", { name: /My writing/ })).toBeVisible();
  await expect(page.locator("#main").getByText(text)).toBeVisible();

  // The parent sees the writing card and the report with the child's own sentence.
  await page.goto("/child/home");
  await passParentGate(page);
  await expect(page.getByRole("heading", { name: "Writing" })).toBeVisible();
  await page.getByRole("link", { name: /Writing progress/ }).click();
  await expect(page).toHaveURL(/\/parent\/writing\?child=/);
  await expect(page.locator("#main").getByText(text)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Handwriting" })).toBeVisible();
  await expect(page.getByText(/not handwriting recognition/)).toBeVisible();
});

test("admins manage writing content: glyphs, rubrics and a try-it pad; parents cannot", async ({ page }) => {
  const email = await registerParent(page, "Writing Admin");
  await addChild(page, "Ada", /Kindergarten 1/);
  // A parent does not see the writing CMS.
  await page.goto("/admin/writing");
  await expect(page.getByRole("heading", { name: "Writing", exact: true })).toHaveCount(0);

  const { data: user } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  const userId =
    user?.id ?? (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === email)!.id;
  await admin.from("profiles").update({ role: "admin" }).eq("id", userId);

  await page.goto("/admin/writing");
  await expect(page.getByRole("heading", { name: "Writing", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Glyphs \(\d+\)/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rubric templates" })).toBeVisible();
  await expect(page.getByText("PARAGRAPH_WRITING")).toBeVisible();

  await page
    .getByRole("link", { name: /small a/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/admin\/writing\/glyphs\/lower-a$/);
  await expect(page.getByRole("img", { name: "small a", exact: true }).first()).toBeVisible();
  // Try it: draw the letter's strokes on the pad and read the engine's verdict.
  const pad = page.getByRole("img", { name: /Drawing pad for small a/ });
  // The mouse does not scroll: bring the pad into view first (below the fold on a phone).
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  const { data: glyph } = await admin
    .from("handwriting_glyphs")
    .select("strokes")
    .eq("code", "lower-a")
    .single();
  for (const s of glyph!.strokes as { points: [number, number][] }[]) {
    await page.mouse.move(
      box.x + (s.points[0][0] / 100) * box.width,
      box.y + (s.points[0][1] / 100) * box.height,
    );
    await page.mouse.down();
    for (const [x, y] of s.points.slice(1))
      await page.mouse.move(box.x + (x / 100) * box.width, box.y + (y / 100) * box.height, { steps: 3 });
    await page.mouse.up();
  }
  await expect(page.getByText("✅ complete")).toBeVisible();
});
