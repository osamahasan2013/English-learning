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

test("a weak skill becomes a practice recommendation and a review item", async ({ page }) => {
  await registerParent(page);
  const childId = await addChild(page, "Omar", /Kindergarten 3/);
  await page.getByRole("button", { name: /Start learning as Omar/ }).click();
  await page.getByRole("link", { name: /Next.*sh/ }).click();

  const { questions } = await lessonQuestions("kg3-sh-1");
  await playLesson(page, questions, false);
  await waitForSynced(page);

  const { data: mastery } = await admin
    .from("skill_mastery")
    .select("status, mastery_score, skills(code)")
    .eq("child_id", childId);
  const sh = mastery!.find((m) => (m.skills as unknown as { code: string }).code === "kg3-digraph-sh")!;
  expect(sh.status).toBe("LEARNING");
  expect(Number(sh.mastery_score)).toBeLessThan(70);

  // Child: today's plan now includes practising the weak skill.
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Today/ }).locator("..")).toContainText("Practice");

  // Parent: "Practice SH" recommendation.
  await passParentGate(page);
  await expect(page.getByText("Practice SH")).toBeVisible();
});

test("answers given offline are kept on the device and synced exactly once after reconnecting", async ({
  page,
  context,
}) => {
  await registerParent(page);
  const childId = await addChild(page, "Lina", /Kindergarten 3/);
  await page.getByRole("button", { name: /Start learning as Lina/ }).click();
  await page.getByRole("link", { name: /Next.*sh/ }).click();
  await page.locator("section[data-question-id]").waitFor();

  const { lessonId, questions } = await lessonQuestions("kg3-sh-1");
  await context.setOffline(true);
  await expect(page.getByText("Offline")).toBeVisible();
  await playLesson(page, questions, true);

  // Nothing reached the server while offline.
  const before = await admin
    .from("activity_attempts")
    .select("id", { count: "exact", head: true })
    .eq("child_id", childId);
  expect(before.count).toBe(0);

  await context.setOffline(false);
  await waitForSynced(page);
  const { data: runs } = await admin
    .from("lesson_runs")
    .select("id, total_questions")
    .eq("child_id", childId)
    .eq("lesson_id", lessonId);
  expect(runs).toHaveLength(1);
  const after = await admin
    .from("activity_attempts")
    .select("id", { count: "exact", head: true })
    .eq("child_id", childId);
  expect(after.count).toBe(runs![0].total_questions);

  // Replaying the same events (e.g. a retry after a lost response) stores nothing new.
  const { data: attempts } = await admin
    .from("activity_attempts")
    .select("id, question_id, response, attempt_number, attempted_at")
    .eq("child_id", childId);
  const replay = await page.request.post("/api/sync", {
    data: {
      childId,
      events: attempts!.map((a) => ({
        kind: "attempt",
        id: a.id,
        questionId: a.question_id,
        lessonRunId: runs![0].id,
        attemptNumber: a.attempt_number,
        response: a.response,
        responseTimeMs: 1000,
        attemptedAt: a.attempted_at,
      })),
    },
  });
  expect(replay.ok()).toBe(true);
  const body = await replay.json();
  expect(body.results.every((r: { status: string }) => r.status === "duplicate")).toBe(true);
  const final = await admin
    .from("activity_attempts")
    .select("id", { count: "exact", head: true })
    .eq("child_id", childId);
  expect(final.count).toBe(after.count);

  await passParentGate(page);
  await expect(page.getByText("Lessons completed").locator("..")).toContainText("1");
});
