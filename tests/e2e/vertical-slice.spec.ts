import { expect, test } from "@playwright/test";
import {
  addChild,
  admin,
  lessonQuestions,
  passParentGate,
  playLesson,
  registerParent,
  waitForSynced,
} from "./helpers";

// The first milestone end to end: parent account → child profile with a grade → child
// dashboard → phonics lesson from the database with audio controls and three activity
// types → score → progress saved on the server → parent dashboard shows it.
test("parent creates a child who completes a phonics lesson, and the parent sees the progress", async ({
  page,
}) => {
  await registerParent(page);
  const childId = await addChild(page, "Mia", /Kindergarten 3/);
  await expect(page.getByRole("heading", { name: "Mia" })).toBeVisible();
  await expect(page.getByText("Kindergarten 3").first()).toBeVisible();

  await page.getByRole("button", { name: /Start learning as Mia/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);
  await expect(page.getByRole("heading", { name: "Hi, Mia!" })).toBeVisible();

  // KG3 starts with the SH digraph lesson.
  await page.getByRole("link", { name: /Next.*sh/ }).click();
  await expect(page).toHaveURL(/\/child\/learn\//);
  await expect(page.getByRole("button", { name: /Listen/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Slow/ }).first()).toBeVisible();

  const { lessonId, questions } = await lessonQuestions("kg3-sh-1");
  const types = new Set([...questions.values()].map((q) => q.question_type));
  expect(types.size).toBeGreaterThanOrEqual(3);

  await playLesson(page, questions, true);
  await expect(page.getByText(/You got \d+ of \d+ right the first time/)).toBeVisible();
  await expect(page.getByLabel("3 out of 3 stars")).toBeVisible();
  await waitForSynced(page);

  // Stored on the server, scored by the server.
  const { data: runs } = await admin
    .from("lesson_runs")
    .select("score_percent, stars, total_questions")
    .eq("child_id", childId)
    .eq("lesson_id", lessonId);
  expect(runs).toHaveLength(1);
  expect(Number(runs![0].score_percent)).toBe(100);
  expect(runs![0].stars).toBe(3);
  const { count } = await admin
    .from("activity_attempts")
    .select("id", { count: "exact", head: true })
    .eq("child_id", childId);
  expect(count).toBe(runs![0].total_questions);

  // Home shows the completed lesson and the new stars.
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("link", { name: /stars\. See my rewards/ })).toContainText(/[1-9]/);

  await passParentGate(page);
  await expect(page.getByText("Lessons completed").locator("..")).toContainText("1");
  await expect(page.getByRole("heading", { name: "Recent lessons" }).locator("..")).toContainText(
    "The sh sound",
  );
  await expect(page.getByRole("heading", { name: "Skills" }).locator("..")).toContainText("SH");
  await expect(page.getByRole("heading", { name: "Achievements" }).locator("..")).toContainText(
    "First Lesson",
  );
});
