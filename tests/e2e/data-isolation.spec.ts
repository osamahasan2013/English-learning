import { expect, test } from "@playwright/test";
import { addChild, admin, lessonQuestions, passParentGate, registerParent } from "./helpers";

// One family can never see or write another family's child, whatever ids they send.
test("a parent cannot view or write progress for another family's child", async ({ browser }) => {
  const familyA = await browser.newContext();
  const pageA = await familyA.newPage();
  await registerParent(pageA, "Parent A");
  const childA = await addChild(pageA, "Aya", /Kindergarten 1/);

  const familyB = await browser.newContext();
  const pageB = await familyB.newPage();
  await registerParent(pageB, "Parent B");
  const childB = await addChild(pageB, "Ben", /Kindergarten 2/);

  // Page for another family's child: not found.
  await pageB.goto(`/parent/children/${childA}`);
  await expect(pageB.getByRole("heading", { name: "Page not found" })).toBeVisible();

  // Dashboard with another family's child id falls back to B's own child.
  await pageB.goto(`/parent/dashboard?child=${childA}`);
  await expect(pageB.getByRole("heading", { name: "Ben" })).toBeVisible();
  await expect(pageB.getByText("Aya")).toHaveCount(0);

  // Sync API refuses events for another family's child.
  const response = await pageB.request.post("/api/sync", {
    data: {
      childId: childA,
      events: [
        {
          kind: "lesson_run",
          id: crypto.randomUUID(),
          lessonId: crypto.randomUUID(),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      ],
    },
  });
  expect(response.status()).toBe(403);

  // A signed-out request is refused outright.
  const anonymous = await browser.newContext();
  const anon = await anonymous.request.post("http://127.0.0.1:3000/api/sync", {
    data: { childId: childB, events: [] },
  });
  expect(anon.status()).toBe(401);

  await Promise.all([familyA.close(), familyB.close(), anonymous.close()]);
});

// Child mode: grown-up pages send the child back until the gate is passed, and the sync
// API (the real route, not just the writer) only credits a lesson for its own answers.
test("child mode keeps grown-up pages behind the gate; a forged lesson run is refused", async ({ page }) => {
  await registerParent(page, "Gate Parent");
  const childId = await addChild(page, "Ava", /Kindergarten 1/);
  await page.getByRole("button", { name: /Start learning as Ava/ }).click();
  await expect(page.getByRole("heading", { name: "Hi, Ava!" })).toBeVisible();

  for (const path of ["/parent/dashboard", "/parent/settings", "/update-password", "/admin/dashboard"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/child\/home$/);
  }

  // One right answer to a KG1 question, claimed as a finished Grade 2 lesson.
  const letterA = await lessonQuestions("kg1-letter-a-1");
  const q = [...letterA.questions.values()].find((x) => x.question_type === "MULTIPLE_CHOICE")!;
  const { data: target } = await admin.from("lessons").select("id").eq("code", "g2-suffixes-1").single();
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const response = await page.request.post("/api/sync", {
    data: {
      childId,
      events: [
        {
          kind: "attempt",
          id: crypto.randomUUID(),
          questionId: q.id,
          lessonRunId: runId,
          sessionId: null,
          attemptNumber: 1,
          response: { value: (q.answer as { accepted: string[] }).accepted[0] },
          responseTimeMs: 900,
          attemptedAt: now,
        },
        { kind: "lesson_run", id: runId, lessonId: target!.id, startedAt: now, completedAt: now },
      ],
    },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { results: { status: string; reason?: string }[] };
  expect(body.results.map((r) => r.status)).toEqual(["stored", "rejected"]);

  await passParentGate(page);
  await page.goto("/parent/settings");
  await expect(page).toHaveURL(/\/parent\/settings$/);
});
