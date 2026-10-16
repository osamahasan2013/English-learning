import { expect, test, type Page } from "@playwright/test";
import { addChild, admin, answerQuestion, passParentGate, registerParent, waitForSynced } from "./helpers";

// The Phase 9 assessment engine end to end: a parent starts "Find My Level"; the child takes
// it (offline, no feedback, "I don't know" allowed, the level ladder decides how far it
// goes); the server scores it once after reconnecting; the parent sees instructional levels
// with confidence and the history. Parents can cancel a waiting check; admins see the
// blueprints. Everything is checked against real database records.

type QuestionRow = {
  id: string;
  question_type: string;
  content: Record<string, unknown>;
  answer: Record<string, unknown> | null;
};

async function sittingQuestions(childId: string) {
  const { data: sitting } = await admin
    .from("assessment_attempts")
    .select("id, item_ids")
    .eq("child_id", childId)
    .eq("status", "in_progress")
    .single();
  const { data: questions } = await admin
    .from("questions")
    .select("id, question_type, content, answer")
    .in("id", sitting!.item_ids);
  return {
    sittingId: sitting!.id as string,
    items: sitting!.item_ids.length as number,
    questions: new Map((questions as QuestionRow[]).map((q) => [q.id, q])),
  };
}

function checkRow(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
}

test("a parent starts Find My Level; the child takes it offline without feedback; the parent sees levels and history", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  await registerParent(page);
  const childId = await addChild(page, "Maya", /Kindergarten 3/);
  const { data: before } = await admin.from("children").select("grade_level_id").eq("id", childId).single();

  // Dashboard: no evidence yet, so every area starts at the school grade.
  await expect(page.getByRole("heading", { name: "Level by area" })).toBeVisible();
  await expect(page.getByText(/No evidence yet/)).toBeVisible();

  // Parent starts the placement check.
  await page.goto(`/parent/assessments?child=${childId}`);
  await expect(page.getByRole("heading", { name: "Where Maya is working" })).toBeVisible();
  await checkRow(page, "Find My Level").getByRole("button", { name: "Start" }).click();
  await expect(page.getByText(/The check is ready/)).toBeVisible();
  await expect(checkRow(page, "Find My Level").getByRole("button", { name: "Cancel check" })).toBeVisible();
  // Starting again does not open a second sitting.
  await checkRow(page, "Find My Level").getByRole("button", { name: "Start" }).click();
  await expect(page.getByText(/already waiting/)).toBeVisible();
  const { count: open } = await admin
    .from("assessment_attempts")
    .select("id", { count: "exact", head: true })
    .eq("child_id", childId)
    .eq("status", "in_progress");
  expect(open).toBe(1);

  // Child mode: the check waits on the home screen.
  await page.goto(`/parent/dashboard?child=${childId}`);
  await page.getByRole("button", { name: /Start learning as Maya/ }).click();
  await page.getByRole("link", { name: /A check is waiting/ }).click();
  await expect(page).toHaveURL(/\/child\/assess\//);
  const { sittingId, items, questions } = await sittingQuestions(childId);
  expect(items).toBeGreaterThan(0);

  // Offline from here: answers go to the device outbox.
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator("section[data-question-id]")).toBeVisible();
  await context.setOffline(true);

  let answered = 0;
  let skipped = 0;
  for (let guard = 0; guard < 150; guard++) {
    const finished = page.getByRole("heading", { level: 1, name: /You finished/ });
    const section = page.locator("section[data-question-id]");
    await finished.or(section).first().waitFor();
    if (await finished.isVisible()) break;
    const id = (await section.getAttribute("data-question-id"))!;
    // The first item is answered wrongly: no retry, no feedback, straight on.
    if (answered === 0) {
      await answerQuestion(page, questions.get(id)!, false);
      await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
      answered++;
    } else if (answered < 6) {
      await answerQuestion(page, questions.get(id)!, true);
      answered++;
    } else {
      await page.getByRole("button", { name: /I don.t know/ }).click();
      skipped++;
    }
    await expect(section.and(page.locator(`[data-question-id="${id}"]`))).toHaveCount(0);
  }
  await expect(page.getByText("Thank you! You did your best.")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("%");
  expect(skipped).toBeGreaterThan(0);

  // Nothing reached the server while offline; after reconnecting it is stored exactly once.
  const { count: offlineCount } = await admin
    .from("activity_attempts")
    .select("id", { count: "exact", head: true })
    .eq("assessment_attempt_id", sittingId);
  expect(offlineCount).toBe(0);
  await context.setOffline(false);
  await waitForSynced(page);

  const { data: answers } = await admin
    .from("activity_attempts")
    .select("question_id, is_correct, response, partial_credit")
    .eq("assessment_attempt_id", sittingId);
  expect(answers!.length).toBe(answered + skipped);
  expect(new Set(answers!.map((a) => a.question_id)).size).toBe(answers!.length);
  expect(answers!.filter((a) => (a.response as { skipped?: boolean }).skipped)).toHaveLength(skipped);
  for (const a of answers!) expect(questions.has(a.question_id)).toBe(true);

  const { data: sitting } = await admin
    .from("assessment_attempts")
    .select("status, completed_at")
    .eq("id", sittingId)
    .single();
  expect(sitting!.status).toBe("completed");
  const { data: results } = await admin
    .from("assessment_results")
    .select("overall_score, readiness, evidence_summary")
    .eq("assessment_attempt_id", sittingId);
  expect(results).toHaveLength(1);
  const { data: readiness } = await admin
    .from("instructional_readiness")
    .select("domain, confidence, source")
    .eq("child_id", childId);
  expect(readiness!.map((r) => r.domain).sort()).toEqual([
    "PHONICS",
    "READING",
    "SPELLING",
    "VOCABULARY",
    "WRITING",
  ]);
  // The school grade never changes because of a check.
  const { data: after } = await admin.from("children").select("grade_level_id").eq("id", childId).single();
  expect(after!.grade_level_id).toBe(before!.grade_level_id);

  // Re-syncing the same answers changes nothing (idempotent).
  await page.reload();
  await waitForSynced(page);
  const { count: again } = await admin
    .from("activity_attempts")
    .select("id", { count: "exact", head: true })
    .eq("assessment_attempt_id", sittingId);
  expect(again).toBe(answers!.length);

  // Parent: levels with confidence and evidence, the history with per-section results.
  await page.goto("/child/home");
  await passParentGate(page);
  await page.goto(`/parent/assessments?child=${childId}`);
  const levels = page.getByRole("list", { name: "Instructional level by area" });
  await expect(levels.getByRole("heading", { name: "Phonics" })).toBeVisible();
  await expect(levels).toContainText(/Working at/);
  await expect(levels).toContainText(/confidence|Not enough evidence yet/);
  const history = page.getByRole("heading", { name: "Check history" }).locator("..");
  await expect(history).toContainText("Find My Level");
  await expect(history).toContainText("Completed");
  await expect(page.getByText("No check is waiting.")).toBeVisible();
});

test("a parent can cancel a waiting check; its answers stay as practice", async ({ page }) => {
  await registerParent(page);
  const childId = await addChild(page, "Noor", /Kindergarten 2/);
  await page.goto(`/parent/assessments?child=${childId}`);
  await checkRow(page, "Phonics Check").getByRole("button", { name: "Start" }).click();
  await expect(page.getByText(/The check is ready/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel check" }).click();
  await expect(page.getByText(/The check was cancelled/)).toBeVisible();
  await expect(page.getByText("No check is waiting.")).toBeVisible();
  const { data } = await admin.from("assessment_attempts").select("status").eq("child_id", childId);
  expect(data!.map((s) => s.status)).toEqual(["abandoned"]);
  const history = page.getByRole("heading", { name: "Check history" }).locator("..");
  await expect(history).toContainText("Cancelled");
});

test("admins see assessment blueprints, pools and rules; parents cannot", async ({ page }) => {
  const email = await registerParent(page, "Assessment Admin");
  await addChild(page, "Ada", /Kindergarten 1/);
  await page.goto("/admin/assessments");
  await expect(page.getByRole("heading", { name: "Assessments", exact: true })).toHaveCount(0);

  const { data: user } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  const userId =
    user?.id ?? (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === email)!.id;
  await admin.from("profiles").update({ role: "admin" }).eq("id", userId);

  await page.goto("/admin/assessments");
  await expect(page.getByRole("heading", { name: "Assessments", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Find My Level/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Effective rules" })).toBeVisible();
  await expect(page.getByText(/sectionPassPercent/)).toBeVisible();
  // No family data on the admin page.
  await expect(page.locator("main")).not.toContainText("Ada");
});
