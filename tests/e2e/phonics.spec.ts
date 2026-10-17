import { expect, test, type Page } from "@playwright/test";
import {
  addChild,
  admin,
  lessonQuestions,
  passParentGate,
  playLesson,
  registerParent,
  waitForSynced,
} from "./helpers";

// The Phonics Engine end to end, on phone, tablet and desktop: child dashboard → Phonics
// → a letter sound → CVC blending → the sh digraph → the Sound Check → stars on the
// Mastery screen → percentages and per-area results on the parent dashboard, all from
// real database records.

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function openSection(page: Page, name: string) {
  await page.goto("/child/phonics");
  await page.getByRole("navigation", { name: "Phonics" }).getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("button", { name: /Listen/ }).first()).toBeVisible();
}

async function checkQuestions(code: string) {
  const { data: assessment } = await admin.from("assessments").select("id").eq("code", code).single();
  const { data: items } = await admin
    .from("assessment_items")
    .select("question_id")
    .eq("assessment_id", assessment!.id);
  const { data: questions } = await admin
    .from("questions")
    .select("id, question_type, content, answer")
    .in(
      "id",
      items!.map((i) => i.question_id),
    );
  return {
    assessmentId: assessment!.id as string,
    questions: new Map(
      (
        questions as {
          id: string;
          question_type: string;
          content: Record<string, unknown>;
          answer: Record<string, unknown> | null;
        }[]
      ).map((q) => [q.id, q]),
    ),
  };
}

test("a child learns phonics from letters to digraphs, takes the Sound Check, and the parent sees it", async ({
  page,
}) => {
  test.setTimeout(420_000);
  await registerParent(page);
  const childId = await addChild(page, "Leo", /Kindergarten 1/);
  await page.getByRole("button", { name: /Start learning as Leo/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);

  // Dashboard → Phonics: six big cards.
  await page
    .getByRole("link", { name: /Phonics/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Phonics" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Phonics" });
  for (const card of ["Letters", "Sounds", "Blend", "Read Words", "Practice", "Mastery"])
    await expect(nav.getByRole("link", { name: card })).toBeVisible();
  await noSideScroll(page);

  // Letters: A–Z cards; learn the letter a (its name and its sound).
  await openSection(page, "Letters");
  const letters = page.getByRole("list", { name: "Letters A to Z" }).getByRole("link");
  await expect(letters).toHaveCount(26);
  await noSideScroll(page);
  await letters.first().click();
  await expect(page).toHaveURL(/\/child\/learn\//);
  const letterA = await lessonQuestions("kg1-letter-a-1");
  await playLesson(page, letterA.questions, true);
  await expect(page.getByLabel("3 out of 3 stars")).toBeVisible();
  await waitForSynced(page);

  // Blend: short a CVC words (sound tiles, blending, segmenting).
  await openSection(page, "Blend");
  await page
    .getByRole("link", { name: /a words/ })
    .first()
    .click();
  const cvc = await lessonQuestions("kg2-short-a-1");
  const cvcTypes = new Set([...cvc.questions.values()].map((q) => q.question_type));
  expect(cvcTypes).toContain("BLEND_SOUNDS");
  expect(cvcTypes).toContain("SEGMENT_WORD");
  await playLesson(page, cvc.questions, true);
  await waitForSynced(page);

  // Read Words: the sh digraph (find the letters, sort, read, spell).
  await openSection(page, "Read Words");
  await page.getByRole("link", { name: /^sh/ }).first().click();
  const sh = await lessonQuestions("kg3-sh-1");
  expect(new Set([...sh.questions.values()].map((q) => q.question_type))).toContain("FIND_PATTERN");
  await playLesson(page, sh.questions, true);
  await waitForSynced(page);

  // Practice → the Sound Check (one try each), scored per area on the server.
  await openSection(page, "Practice");
  await page.getByRole("link", { name: /Sound Check/ }).click();
  await expect(page).toHaveURL(/\/child\/check\/phonics-check/);
  // Start opens a sitting on the server (which selects the items), then plays it.
  await page.getByRole("button", { name: /^Start/ }).click();
  await expect(page).toHaveURL(/\/child\/assess\//);
  const check = await checkQuestions("phonics-check");
  await playLesson(page, check.questions, true);
  await waitForSynced(page);
  const { data: results } = await admin
    .from("assessment_results")
    .select("overall_score, dimension_scores, assessment_attempts!inner(assessment_id)")
    .eq("child_id", childId);
  expect(results).toHaveLength(1);
  expect(Number(results![0].overall_score)).toBe(100);
  const sections = Object.values(results![0].dimension_scores as Record<string, { label: string }>);
  expect(sections.map((x) => x.label)).toContain("Digraphs");

  // Mastery: stars, never percentages.
  await openSection(page, "Mastery");
  await expect(page.getByRole("img", { name: /Sounds: [1-3] of 3 stars/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Digraphs: [1-3] of 3 stars/ })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("%");
  await noSideScroll(page);

  // Real mastery records behind the stars.
  const { data: mastery } = await admin
    .from("skill_mastery")
    .select("status, skills!inner(code)")
    .eq("child_id", childId)
    .in("skills.code", ["kg1-letter-a", "kg2-short-a", "kg3-digraph-sh"]);
  expect(mastery).toHaveLength(3);
  for (const m of mastery!) expect(m.status).not.toBe("NOT_STARTED");

  // Parent phonics page: progress per stage as counts (letter names kept apart from
  // sounds) and the Sound Check result per area.
  await page.goto("/child/home");
  await passParentGate(page);
  await page.getByRole("navigation", { name: "Parent" }).getByRole("link", { name: "Phonics" }).click();
  const sounds = page.getByRole("region", { name: "Sounds and spelling patterns" });
  await expect(sounds).toContainText(/Letter sounds\s*· \d+ of \d+ mastered · [1-9]\d* practised/);
  await expect(sounds).toContainText("Digraphs");
  await expect(page.getByRole("region", { name: "Letter names and shapes" })).toBeVisible();
  const latestCheck = page.getByRole("heading", { name: "Latest Phonics Check" }).locator("..");
  await expect(latestCheck).toContainText(": secure");
  await expect(latestCheck).not.toContainText("not yet secure");
  await noSideScroll(page);

  // Parents can look patterns up (from the database, filtered and paged).
  await page.goto("/parent/phonics?type=consonant_digraph");
  await expect(page.getByRole("heading", { name: "Phonics patterns" })).toBeVisible();
  // Scoped to the patterns section: while the page streams in, React briefly holds a hidden
  // copy of the results outside <main>, and the child's own phonics progress above the
  // search also mentions example sounds.
  const patterns = page.getByRole("region", { name: "Phonics patterns" });
  await expect(patterns.getByText(/sh as in ship/)).toBeVisible();
  await expect(patterns.getByText(/\(\d+ patterns\)/)).toBeVisible();
  await noSideScroll(page);
});
