import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  addChild,
  admin,
  lessonQuestions,
  playLesson,
  registerParent,
  startLesson,
  waitForSynced,
} from "./helpers";

// Phase 8.4: a parent resets a child's learning or deletes a child, from the child's
// settings. Two "devices" (browser contexts) of the same family: one still holds answers
// recorded offline before the reset / deletion; when it reconnects, those answers must not
// bring anything back.

const CHILD_TABLES = [
  "activity_attempts",
  "lesson_runs",
  "learning_sessions",
  "lesson_progress",
  "activity_progress",
  "skill_mastery",
  "level_progress",
  "subject_progress",
  "review_items",
  "reward_events",
] as const;

async function learningRows(childId: string) {
  let total = 0;
  for (const table of CHILD_TABLES) {
    const { count } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("child_id", childId);
    total += count ?? 0;
  }
  return total;
}

async function secondDevice(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/parent/);
  return { context, page };
}

// Child mode on this device: one finished lesson synced, then the same lesson played
// offline — those answers stay queued on the device.
async function learnThenQueueOffline(page: Page, name: string) {
  await page.getByRole("button", { name: new RegExp(`Start learning as ${name}`) }).click();
  await expect(page).toHaveURL(/\/child\/home/);
  const { lessonId, questions } = await lessonQuestions("kg3-sh-1");
  await page.goto(`/child/learn/${lessonId}`);
  await startLesson(page);
  await playLesson(page, questions, true);
  await waitForSynced(page);
  await page.goto(`/child/learn/${lessonId}`);
  await startLesson(page);
  await page.context().setOffline(true);
  await playLesson(page, questions, true);
  return lessonId;
}

test("reset learning: progress starts again, the profile and grade stay, offline answers cannot restore it", async ({
  page,
  browser,
}) => {
  const email = await registerParent(page);
  const lina = await addChild(page, "Lina", /Kindergarten 3/);
  await page.goto("/parent/children/new");
  const ben = await addChild(page, "Ben", /Kindergarten 2/);
  await page.goto(`/parent/dashboard?child=${lina}`);
  await learnThenQueueOffline(page, "Lina");
  expect(await learningRows(lina)).toBeGreaterThan(0);
  const { data: before } = await admin
    .from("children")
    .select("grade_level_id, name")
    .eq("id", lina)
    .single();

  // The parent, on another device.
  const other = await secondDevice(browser, email);
  await other.page.goto(`/parent/dashboard?child=${lina}`);
  await expect(other.page.getByText("Lessons completed").locator("..")).toContainText("1");
  await other.page.goto("/parent/children");
  await other.page.getByRole("link", { name: "Settings for Lina" }).click();
  await expect(other.page.getByRole("heading", { name: "Learning", exact: true })).toBeVisible();
  await expect(other.page.getByRole("heading", { name: "Danger zone" })).toBeVisible();

  // Cancel changes nothing.
  await other.page.getByRole("button", { name: "Reset Lina's learning…" }).click();
  const dialog = other.page.getByRole("dialog", { name: "Reset learning for Lina?" });
  await expect(dialog).toContainText("Kindergarten 3");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await learningRows(lina)).toBeGreaterThan(0);

  await other.page.getByRole("button", { name: "Reset Lina's learning…" }).click();
  await dialog.getByRole("button", { name: "Reset learning" }).click();
  await expect(other.page.getByRole("status").filter({ hasText: "Lina's learning was reset" })).toBeVisible();
  expect(await learningRows(lina)).toBe(0);
  const { data: after } = await admin
    .from("children")
    .select("grade_level_id, current_level_id, name, learning_epoch")
    .eq("id", lina)
    .single();
  expect(after).toMatchObject({ ...before, current_level_id: before!.grade_level_id, learning_epoch: 1 });

  // The dashboard shows a fresh start at once.
  await other.page.goto(`/parent/dashboard?child=${lina}`);
  await expect(other.page.getByText("Lessons completed").locator("..")).toContainText("0");

  // The first device reconnects: its queued answers from before the reset are dropped.
  await page.context().setOffline(false);
  await waitForSynced(page);
  expect(await learningRows(lina)).toBe(0);
  // The child's own home shows the fresh start too (stars earned before are gone).
  await page.goto("/child/home");
  await expect(page.getByRole("heading", { name: "Hi, Lina!" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^0 stars/ })).toBeVisible();
  // Ben was never touched.
  const { data: benRow } = await admin.from("children").select("name").eq("id", ben).single();
  expect(benRow!.name).toBe("Ben");
  await other.context.close();
});

test("delete child: typed confirmation, other children stay, offline answers cannot recreate the child", async ({
  page,
  browser,
}) => {
  const email = await registerParent(page);
  const mia = await addChild(page, "Mia", /Kindergarten 3/);
  await page.goto("/parent/children/new");
  const leo = await addChild(page, "Leo", /Kindergarten 2/);
  await page.goto(`/parent/dashboard?child=${mia}`);
  await learnThenQueueOffline(page, "Mia");

  const other = await secondDevice(browser, email);
  await other.page.goto(`/parent/children/${mia}`);
  await other.page.getByRole("button", { name: "Delete Mia…" }).click();
  const dialog = other.page.getByRole("dialog", { name: "Delete Mia permanently?" });
  const confirm = dialog.getByRole("button", { name: "Delete Mia" });
  // Nothing happens until the name is typed; Escape cancels.
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Type Mia to confirm").fill("Leo");
  await expect(confirm).toBeDisabled();
  await other.page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await other.page.getByRole("button", { name: "Delete Mia…" }).click();
  await dialog.getByLabel("Type Mia to confirm").fill("mia");
  await confirm.click();

  await expect(other.page).toHaveURL(/\/parent\/dashboard/);
  await expect(other.page.getByRole("heading", { level: 1, name: "Leo" })).toBeVisible();
  await other.page.goto("/parent/children");
  await expect(other.page.getByRole("heading", { name: "Leo" })).toBeVisible();
  await expect(other.page.getByRole("heading", { name: "Mia" })).toHaveCount(0);
  const { data: gone } = await admin.from("children").select("id").eq("id", mia);
  expect(gone).toEqual([]);
  expect(await learningRows(mia)).toBe(0);
  await other.page.goto(`/parent/children/${mia}`);
  await expect(other.page.getByRole("heading", { name: "Page not found" })).toBeVisible();

  // The first device reconnects: it was in child mode as Mia, who no longer exists. It is
  // sent to the parent area, and its queued answers are dropped — Mia is not recreated.
  await page.context().setOffline(false);
  await page.goto("/child/home");
  await expect(page).toHaveURL(/\/parent\/dashboard/);
  await waitForSynced(page);
  const { data: still } = await admin.from("children").select("id").eq("id", mia);
  expect(still).toEqual([]);
  expect(await learningRows(mia)).toBe(0);
  const { data: leoRow } = await admin.from("children").select("name").eq("id", leo).single();
  expect(leoRow!.name).toBe("Leo");
  await other.context.close();
});

test("another family cannot reach a child's settings by changing the URL", async ({ page, browser }) => {
  await registerParent(page, "Parent A");
  const child = await addChild(page, "Aya", /Kindergarten 1/);
  const familyB = await browser.newContext();
  const pageB = await familyB.newPage();
  await registerParent(pageB, "Parent B");
  await pageB.goto(`/parent/children/${child}`);
  await expect(pageB.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(pageB.getByRole("button", { name: /Delete Aya/ })).toHaveCount(0);
  const { data } = await admin.from("children").select("id").eq("id", child);
  expect(data).toHaveLength(1);
  await familyB.close();
});
