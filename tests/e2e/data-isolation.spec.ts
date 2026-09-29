import { expect, test } from "@playwright/test";
import { addChild, registerParent } from "./helpers";

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
