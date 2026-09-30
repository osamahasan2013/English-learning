import { expect, test } from "@playwright/test";
import {
  addChild,
  admin,
  answerQuestion,
  lessonQuestions,
  passParentGate,
  playLesson,
  registerParent,
  startLesson,
  waitForSynced,
} from "./helpers";

// The Phase 3 learning engine in the browser: the new activity types, the lesson
// player's intro / previous / exit / resume, prerequisite previews, and answers that
// never reach the page.

test("a child plays lessons with matching, sorting, drag-and-drop, tracing, reading and writing", async ({
  page,
}) => {
  await registerParent(page);
  const childId = await addChild(page, "Sami", /Kindergarten 2/);
  await page.getByRole("button", { name: /Start learning as Sami/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);

  for (const code of [
    "kg2-word-games-1",
    "kg1-trace-letters-1",
    "g1-word-reading-1",
    "g2-sentence-reading-1",
  ]) {
    const { lessonId, questions } = await lessonQuestions(code);
    await page.goto(`/child/learn/${lessonId}`);
    await playLesson(page, questions, true);
    await expect(page.getByText(/You got \d+ of \d+ right the first time/)).toBeVisible();
    await expect(page.getByLabel("3 out of 3 stars")).toBeVisible();
  }
  await waitForSynced(page);

  const { data: runs } = await admin
    .from("lesson_runs")
    .select("score_percent, lessons(code)")
    .eq("child_id", childId);
  expect(runs).toHaveLength(4);
  expect(runs!.every((r) => Number(r.score_percent) === 100)).toBe(true);
  const { data: attempts } = await admin
    .from("activity_attempts")
    .select("question_type, is_correct")
    .eq("child_id", childId);
  const types = new Set(attempts!.map((a) => a.question_type));
  for (const t of ["MATCH", "SORT", "DRAG_DROP", "TRACING", "READING", "WRITING"]) expect(types).toContain(t);
  expect(attempts!.every((a) => a.is_correct)).toBe(true);
});

test("the lesson player shows an intro, goes back, and resumes after exiting", async ({ page }) => {
  await registerParent(page);
  const childId = await addChild(page, "Rami", /Kindergarten 3/);
  await page.getByRole("button", { name: /Start learning as Rami/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);
  await page.getByRole("link", { name: /Next.*sh/ }).click();

  // Intro: title, what it is about, audio.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /Listen/ }).first()).toBeVisible();
  const { questions } = await lessonQuestions("kg3-sh-1");
  await startLesson(page);

  // Step 1 is the intro activity; step 2 is answered, then on to step 3.
  await page.getByRole("button", { name: /^Next/ }).click();
  const section = page.locator("section[data-question-id]");
  const secondId = (await section.getAttribute("data-question-id"))!;
  await answerQuestion(page, questions.get(secondId)!, true);
  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(section).not.toHaveAttribute("data-question-id", secondId);
  const thirdId = (await section.getAttribute("data-question-id"))!;

  // Back to the finished step: read-only, answer kept; then forward again.
  await page.getByRole("button", { name: /^Back/ }).click();
  await expect(page.getByText("Looking back. Your answer is saved.")).toBeVisible();
  await expect(section).toHaveAttribute("data-question-id", secondId);
  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(section).toHaveAttribute("data-question-id", thirdId);

  // Exit asks first, then leaves with nothing lost.
  await page.getByRole("button", { name: "Stop the lesson" }).click();
  await expect(page.getByRole("dialog", { name: "Stop for now?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep going" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Stop the lesson" }).click();
  await page.getByRole("link", { name: "Stop" }).click();
  await expect(page).toHaveURL(/\/child\/home/);
  await waitForSynced(page);

  // The server knows the lesson was started but not finished.
  const { data: progress } = await admin
    .from("lesson_progress")
    .select("status, runs_count, lessons(code)")
    .eq("child_id", childId);
  const sh = progress!.find((p) => (p.lessons as unknown as { code: string }).code === "kg3-sh-1");
  expect(sh).toMatchObject({ status: "IN_PROGRESS", runs_count: 0 });

  // Coming back offers to continue at the same step.
  await page.getByRole("link", { name: /Keep going.*sh/ }).click();
  await page.getByRole("button", { name: "Keep going" }).click();
  await expect(section).toHaveAttribute("data-question-id", thirdId);
  await playLesson(page, questions, true);
  await expect(page.getByText(/You finished/)).toBeVisible();
});

test("a lesson whose prerequisites are not ready offers practice first and a sneak peek", async ({
  page,
}) => {
  await registerParent(page);
  const childId = await addChild(page, "Dana", /Kindergarten 2/);
  await page.getByRole("button", { name: /Start learning as Dana/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);

  const { lessonId, questions } = await lessonQuestions("kg2-cvc-check-1");
  await page.goto(`/child/learn/${lessonId}`);
  await expect(page.getByText("This one is a stretch!")).toBeVisible();
  await expect(page.getByRole("link", { name: /Practise/ })).toBeVisible();
  await page.getByRole("button", { name: "Sneak peek" }).click();
  await playLesson(page, questions, true);
  await expect(page.getByText("Nice peek!")).toBeVisible();
  await waitForSynced(page);

  // The answers count as practice; a peek is not a completed lesson.
  const { count: answered } = await admin
    .from("activity_attempts")
    .select("id", { count: "exact", head: true })
    .eq("child_id", childId)
    .eq("lesson_id", lessonId);
  expect(answered).toBe(3);
  const { count: runs } = await admin
    .from("lesson_runs")
    .select("id", { count: "exact", head: true })
    .eq("child_id", childId);
  expect(runs).toBe(0);
});

test("correct answers are not sent to the browser before the child answers", async ({ page }) => {
  await registerParent(page);
  await addChild(page, "Nia", /Grade 1/);
  await page.getByRole("button", { name: /Start learning as Nia/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);

  const { lessonId } = await lessonQuestions("g1-word-reading-1");
  await page.goto(`/child/learn/${lessonId}`);
  await expect(page.getByRole("heading", { name: "Read and match" })).toBeVisible();
  // The server-rendered page, including the serialized lesson payload in its scripts.
  const html = await page.content();
  expect(html).toContain("answerKey");
  // Neither the answer fields nor a matching pair appear anywhere in the page payload.
  for (const leak of [
    '\\"accepted\\"',
    '\\"acceptedSequences\\"',
    '\\"pairs\\":[',
    '\\"boat\\",\\"pic-boat\\"',
  ])
    expect(html).not.toContain(leak);
});

test("parent progress shows activities, average score, learning time and subjects", async ({ page }) => {
  await registerParent(page);
  await addChild(page, "Yara", /Kindergarten 2/);
  await page.getByRole("button", { name: /Start learning as Yara/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);
  const { lessonId, questions } = await lessonQuestions("kg2-word-games-1");
  await page.goto(`/child/learn/${lessonId}`);
  await playLesson(page, questions, true);
  await waitForSynced(page);

  // Child home: subject progress and recent lessons from the server.
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: /My subjects/ })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: /Games: 1 of 1 lessons done/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Recent lessons/ }).locator("..")).toContainText(
    "Word games",
  );
  await expect(page.getByRole("heading", { name: /My skills/ })).toBeVisible();

  await passParentGate(page);
  await expect(page.getByText("Activities completed").locator("..")).toContainText("3");
  await expect(page.getByText("Average score").locator("..")).toContainText("100");
  await expect(page.getByText("Learning time (min)").locator("..")).toContainText("1 learning session");
  await expect(page.getByRole("progressbar", { name: "Games lessons completed" })).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
});
