import { expect, test, type Page } from "@playwright/test";
import {
  addChild,
  admin,
  lessonQuestions,
  passParentGate,
  playLesson,
  registerParent,
  startLesson,
  waitForSynced,
} from "./helpers";

// Phase 10 — the parent experience end to end, against real database records: dashboard →
// add and switch children → progress → checks → practice (Start hands the device to the
// child straight into the recommended lesson) → every area page → reset with a typed name →
// delete → the other child is untouched. Then the parent pages at phone, tablet and
// desktop sizes, and the offline note.

const PARENT_PAGES = [
  "/parent/dashboard",
  "/parent/progress",
  "/parent/practice",
  "/parent/assessments",
  "/parent/phonics",
  "/parent/words",
  "/parent/spelling",
  "/parent/reading",
  "/parent/writing",
  "/parent/children",
];

// Wording a parent must never see (Phase 10 data-truth rules).
const MISLEADING =
  /words per minute|\bWPM\b|\bbehind\b|above grade level|below grade level|AI[- ]evaluated|IQ score/i;

const recentCard = (page: Page) => page.getByRole("heading", { name: "Recent learning" }).locator("..");

async function mainText(page: Page) {
  return (await page.locator("#main").textContent()) ?? "";
}

test("a parent follows one child's learning, practises, resets and deletes — the other child is untouched", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await registerParent(page);
  const maya = await addChild(page, "Maya", /Kindergarten 3/);

  // A brand-new child: truthful empty states.
  await expect(page.getByRole("heading", { level: 1, name: "Maya" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Learning at, by area" }).getByRole("listitem")).toHaveCount(5);
  await expect(page.getByText("Nothing urgent right now.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Progress by area" })).toContainText("Not enough evidence yet");
  await expect(recentCard(page)).toContainText("No finished lessons yet");
  await expect(page.getByRole("link", { name: /Find My Level.*has not been taken yet/ })).toBeVisible();

  // A second child.
  await page.goto("/parent/children/new");
  const omar = await addChild(page, "Omar", /Grade 1/);
  expect(omar).not.toBe(maya);

  // Switch to Maya; the chosen child stays while moving between sections.
  await page.getByRole("navigation", { name: "Choose a child" }).getByRole("link", { name: /Maya/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Maya" })).toBeVisible();
  await page.getByRole("navigation", { name: "Parent" }).getByRole("link", { name: "Progress" }).click();
  await expect(page).toHaveURL(new RegExp(`/parent/progress\\?child=${maya}`));
  await expect(page.getByRole("heading", { level: 1, name: "Maya's progress" })).toBeVisible();
  for (const area of ["Phonics", "Vocabulary", "Spelling", "Reading", "Writing"])
    await expect(page.getByRole("region", { name: area, exact: true })).toBeVisible();
  await expect(page.getByText(/Not enough answers yet to show a trend/).first()).toBeVisible();

  // Practice: the adaptive engine's top priority with its reason and a tip for home.
  await page.getByRole("navigation", { name: "Parent" }).getByRole("link", { name: "Practice" }).click();
  await expect(page).toHaveURL(new RegExp(`/parent/practice\\?child=${maya}`));
  const top = page.getByRole("heading", { name: "Top priority" }).locator("..");
  await expect(top).toContainText("Why:");
  await expect(top).toContainText("At home:");
  const topTitle = (await top.locator("li p.font-bold").first().textContent())!.trim();

  // Start hands the device to Maya, straight into that lesson.
  await top.getByRole("button", { name: /Start .* as Maya/ }).click();
  await expect(page).toHaveURL(/\/child\/learn\/[0-9a-f-]{36}/);
  const lessonId = page.url().split("/child/learn/")[1];
  const { data: lesson } = await admin
    .from("lessons")
    .select("code, title, child_title")
    .eq("id", lessonId)
    .single();
  expect(topTitle).toContain(lesson!.child_title || lesson!.title);
  const { questions } = await lessonQuestions(lesson!.code);
  await startLesson(page);
  await playLesson(page, questions, true);
  await waitForSynced(page);

  // Back to the parent: the finished lesson is in Maya's recent learning, and the server
  // stored it for Maya only.
  await page.goto("/child/home");
  await passParentGate(page);
  await page.goto(`/parent/dashboard?child=${maya}`);
  await expect(page.getByRole("heading", { name: "Recent learning" }).locator("..")).toContainText(
    lesson!.child_title || lesson!.title,
  );
  const { count: omarRuns } = await admin
    .from("lesson_runs")
    .select("id", { count: "exact", head: true })
    .eq("child_id", omar);
  expect(omarRuns).toBe(0);

  // Checks: the evidence wording and what a check is not.
  await page.getByRole("navigation", { name: "Parent" }).getByRole("link", { name: "Checks" }).click();
  await expect(page).toHaveURL(new RegExp(`child=${maya}`));
  await expect(page.getByRole("heading", { name: "Where Maya is working" })).toBeVisible();
  const help = page.getByRole("heading", { name: "About these results" }).locator("..");
  await expect(help).toContainText("not a school grade");
  await expect(help).toContainText("not an IQ test");

  // Every area page for Maya: overview first, honest wording throughout.
  for (const [path, area] of [
    ["/parent/phonics", "phonics"],
    ["/parent/words", "vocabulary"],
    ["/parent/spelling", "spelling"],
    ["/parent/reading", "reading"],
    ["/parent/writing", "writing"],
  ]) {
    await page.goto(`${path}?child=${maya}`);
    await expect(page.getByRole("heading", { name: `Maya's ${area} at a glance` })).toBeVisible();
    expect(await mainText(page)).not.toMatch(MISLEADING);
  }
  await page.goto(`/parent/phonics?child=${maya}`);
  await expect(page.getByRole("heading", { name: "Letter names and shapes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sounds and spelling patterns" })).toBeVisible();
  await page.goto(`/parent/reading?child=${maya}`);
  await expect(page.locator("#main")).toContainText(/no speed or pronunciation score/);
  await page.goto(`/parent/writing?child=${maya}`);
  await expect(page.locator("#main")).toContainText(/cannot understand meaning/);

  // Omar's pages show none of Maya's learning.
  await page.goto(`/parent/dashboard?child=${omar}`);
  await expect(page.getByRole("heading", { level: 1, name: "Omar" })).toBeVisible();
  await expect(recentCard(page)).toContainText("No finished lessons yet");
  // (Maya's lesson may be Omar's own next step too; his recent learning is empty.)

  // A crafted child id never shows another family's child: the first own child instead.
  await page.goto(`/parent/progress?child=${crypto.randomUUID()}`);
  await expect(page.getByRole("heading", { level: 1, name: "Maya's progress" })).toBeVisible();

  // Reset Maya: the name must be typed; history goes, the profile stays.
  await page.goto(`/parent/children/${maya}`);
  await page.getByRole("button", { name: "Reset Maya's learning…" }).click();
  const reset = page.getByRole("dialog", { name: "Reset learning for Maya?" });
  await expect(reset).toContainText("This can't be undone.");
  await expect(reset.getByRole("button", { name: "Reset learning" })).toBeDisabled();
  await reset.getByLabel("Type Maya to confirm").fill("Maya");
  await reset.getByRole("button", { name: "Reset learning" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Maya's learning was reset" })).toBeVisible();
  const { count: mayaRuns } = await admin
    .from("lesson_runs")
    .select("id", { count: "exact", head: true })
    .eq("child_id", maya);
  expect(mayaRuns).toBe(0);
  await page.goto(`/parent/dashboard?child=${maya}`);
  await expect(recentCard(page)).toContainText("No finished lessons yet");

  // Delete Omar: Maya stays.
  await page.goto(`/parent/children/${omar}`);
  await page.getByRole("button", { name: "Delete Omar…" }).click();
  await page
    .getByRole("dialog", { name: "Delete Omar permanently?" })
    .getByLabel("Type Omar to confirm")
    .fill("Omar");
  await page.getByRole("button", { name: "Delete Omar", exact: true }).click();
  await expect(page).toHaveURL(/\/parent\/dashboard/);
  await expect(page.getByRole("heading", { level: 1, name: "Maya" })).toBeVisible();
  const { data: left } = await admin.from("children").select("id").in("id", [maya, omar]);
  expect(left!.map((c) => c.id)).toEqual([maya]);
});

test("the parent pages fit phone, tablet and desktop, with one main heading each", async ({ page }) => {
  test.setTimeout(180_000);
  await registerParent(page);
  const child = await addChild(page, "Lena", /Kindergarten 2/);
  for (const size of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    for (const path of PARENT_PAGES) {
      await page.goto(path === "/parent/children" ? path : `${path}?child=${child}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} at ${size.width}×${size.height}`).toBeLessThanOrEqual(1);
      // Every Start button says what it starts and for whom.
      for (const name of await page
        .getByRole("button", { name: /^▶ Start/ })
        .filter({ hasNotText: "Start learning" })
        .allTextContents())
        expect(name).toMatch(/Start .+ as Lena/);
    }
  }
});

test("the parent area says when it is offline, and keeps working", async ({ page, context }) => {
  await registerParent(page);
  await addChild(page, "Ivo", /Kindergarten 1/);
  await expect(page.getByRole("heading", { level: 1, name: "Ivo" })).toBeVisible();
  await context.setOffline(true);
  await expect(
    page.getByText("You're offline. Some information may be out of date.", { exact: false }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/You're offline/)).toHaveCount(0);
});
