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

// Phase 7 vertical slice, with real content from the database: child home → Reading → a
// story → get ready → words to know → the phonics pattern → listen and read (sentence
// highlighting, tap a word for help, "I read it", self-check) → questions about the text
// (choice, ordering, true/false; look back at the story) → tricky words → read again →
// completion → the server stores the reading session and the answers → the parent sees the
// reading report. Then the reading screens at phone, tablet and desktop sizes.

const section = (page: Page) => page.locator("section[data-question-id]");

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("a child reads a story with help, answers questions about it, and the parent sees the reading", async ({
  page,
}) => {
  await registerParent(page);
  const childId = await addChild(page, "Mia", /Kindergarten 3/);
  await page.getByRole("button", { name: /Start learning as Mia/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);

  await page
    .getByRole("link", { name: /Reading/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/child\/reading$/);
  await expect(page.getByRole("heading", { name: /For you/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Story shelf/ })).toBeVisible();

  const { lessonId, questions } = await lessonQuestions("kg3-read-sam-and-the-shell");
  await page
    .getByRole("link", { name: /Sam and the Shell/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/child/learn/${lessonId}$`));
  await startLesson(page);

  const { data: shell } = await admin.from("words").select("id").eq("normalized_word", "shell").single();
  const seen = new Set<string>();
  let readOnce = false;
  for (let guard = 0; guard < 40; guard++) {
    const finished = page.getByRole("heading", { level: 1, name: /You finished/ });
    await finished.or(section(page)).first().waitFor();
    if (await finished.isVisible()) break;
    const q = questions.get((await section(page).getAttribute("data-question-id"))!)!;
    seen.add(q.question_type);
    const next = page.getByRole("button", { name: /^Next/ });

    if (q.question_type === "READ_PASSAGE" && !readOnce) {
      readOnce = true;
      // Listen first (KG3): the text is read sentence by sentence.
      await expect(section(page).getByRole("list", { name: "Reading steps" })).toContainText("Listen");
      await section(page)
        .getByRole("button", { name: /Listen/ })
        .click();
      // A word the child needs help with is said and remembered.
      await section(page).getByRole("button", { name: "shell", exact: true }).first().click();
      await section(page)
        .getByRole("button", { name: /I read it/ })
        .click();
      await section(page).getByRole("button", { name: /Easy/ }).click();
      await expect(section(page).getByRole("button", { name: /Easy/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      // Stay a moment so the reading counts (short flashes are not reported).
      await page.waitForTimeout(3200);
      await next.click();
      continue;
    }
    if (await next.isVisible()) {
      await next.click();
      continue;
    }
    if (q.question_type === "READING") {
      // The story is there to look back at.
      await expect(section(page).getByRole("button", { name: /Hide the story/ })).toBeVisible();
    }
    await answerQuestion(page, q, true);
    if (q.question_type === "READING" && (q.content as { ref?: unknown }).ref) {
      // After answering, the sentence with the answer is pointed at.
      await expect(section(page).getByText("The answer is here:")).toBeAttached();
    }
    await next.click();
  }
  await expect(page.getByRole("heading", { level: 1, name: /You finished/ })).toBeVisible();
  for (const type of [
    "INTRO",
    "FIND_PATTERN",
    "READ_PASSAGE",
    "READING",
    "ORDER_EVENTS",
    "LISTEN_AND_CHOOSE",
  ])
    expect(seen.has(type), type).toBe(true);
  await waitForSynced(page);

  // The server stored the reading (the story's word count, the help word) and the answers.
  const { data: sessions } = await admin
    .from("reading_sessions")
    .select("mode, word_count, help_word_ids, self_check, lesson_id")
    .eq("child_id", childId)
    .order("started_at");
  expect(sessions!.length).toBeGreaterThanOrEqual(1);
  expect(sessions![0]).toMatchObject({ mode: "listen_first", self_check: "easy", lesson_id: lessonId });
  expect(sessions![0].help_word_ids).toEqual([shell!.id]);
  const { data: attempts } = await admin
    .from("activity_attempts")
    .select("question_type, is_correct")
    .eq("child_id", childId)
    .in("question_type", ["READING", "ORDER_EVENTS"]);
  expect(attempts!.length).toBeGreaterThanOrEqual(4);
  expect(attempts!.every((a) => a.is_correct)).toBe(true);

  // The parent sees the reading report.
  await page.goto("/child/home");
  await passParentGate(page);
  await page.goto(`/parent/reading?child=${childId}`);
  await expect(page.getByRole("heading", { name: /Mia's reading/ })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Reading totals" }).getByText("Reading lessons done (of"),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: /Sam and the Shell/ }).first()).toBeVisible();
  await expect(page.locator("#main").getByText(/shell ×1/)).toBeVisible();
  await expect(page.locator("#main").getByText(/no speed or pronunciation score/)).toBeVisible();
  await page.goto(`/parent/dashboard?child=${childId}`);
  await expect(page.getByRole("link", { name: "Reading progress →" })).toBeVisible();
});

// Runs in each project: phone (Pixel 7), tablet (iPad landscape) and desktop.
test("the reading screens fit the screen", async ({ page }) => {
  await registerParent(page);
  await addChild(page, "Leo", /Grade 2/);
  await page.getByRole("button", { name: /Start learning as Leo/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);
  await page.goto("/child/reading");
  await expect(page.getByRole("heading", { name: /Story shelf/ })).toBeVisible();
  await noSideScroll(page);

  const { lessonId, questions } = await lessonQuestions("g2-read-the-storm-at-the-farm");
  await page.goto(`/child/learn/${lessonId}`);
  await startLesson(page);
  for (let guard = 0; guard < 10; guard++) {
    const q = questions.get((await section(page).getAttribute("data-question-id"))!)!;
    if (q.question_type === "READ_PASSAGE") break;
    const next = page.getByRole("button", { name: /^Next/ });
    if (!(await next.isVisible())) await answerQuestion(page, q, true);
    await next.click();
  }
  // Grade 2 reads first; the text is large, with short lines and tap-to-hear words.
  await expect(section(page).getByRole("list", { name: "Reading steps" })).toContainText("Read");
  const article = section(page).getByRole("article", { name: "The Storm at the Farm" });
  await expect(article).toBeVisible();
  const word = article.getByRole("button", { name: "storm", exact: true }).first();
  expect(await word.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(24);
  // Lines stay short enough to track (about 34–42 characters).
  const lineWidth = await article
    .locator("p")
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(lineWidth).toBeLessThanOrEqual(900);
  const box = (await section(page)
    .getByRole("button", { name: /Listen/ })
    .boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await noSideScroll(page);
});
