import { expect, test } from "@playwright/test";
import { addChild, passParentGate, registerParent } from "./helpers";

test("a parent manages several children and switches between them", async ({ page }) => {
  await registerParent(page);
  const mia = await addChild(page, "Mia", /Kindergarten 1/);

  await page.goto("/parent/children/new");
  const leo = await addChild(page, "Leo", /Grade 1/);
  expect(leo).not.toBe(mia);

  // Dashboard switcher: each child has their own view.
  const switcher = page.getByRole("navigation", { name: "Choose a child" });
  await switcher.getByRole("link", { name: /Mia/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mia" })).toBeVisible();
  await expect(page.getByText(/Kindergarten 1/).first()).toBeVisible();
  await switcher.getByRole("link", { name: /Leo/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Leo" })).toBeVisible();
  await expect(page.getByText(/Grade 1/).first()).toBeVisible();

  // Child mode for Leo, then hand the device to Mia.
  await page.getByRole("button", { name: /Start learning as Leo/ }).click();
  await expect(page.getByRole("heading", { name: "Hi, Leo!" })).toBeVisible();
  await passParentGate(page);
  await switcher.getByRole("link", { name: /Mia/ }).click();
  await page.getByRole("button", { name: /Start learning as Mia/ }).click();
  await expect(page.getByRole("heading", { name: "Hi, Mia!" })).toBeVisible();

  // The children list shows both.
  await passParentGate(page);
  await page.getByRole("link", { name: "Children" }).click();
  await expect(page.getByRole("heading", { name: "Mia" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Leo" })).toBeVisible();
});

test("a parent edits a child's grade and level, and deletes a child", async ({ page }) => {
  await registerParent(page);
  const mia = await addChild(page, "Mia", /Kindergarten 1/);
  await page.goto("/parent/children/new");
  const leo = await addChild(page, "Leo", /Kindergarten 2/);

  // What Leo's profile looks like before Mia is edited.
  const leoProfile = async () => {
    await page.goto(`/parent/children/${leo}`);
    return {
      name: await page.getByLabel("Child's first name or nickname").inputValue(),
      grade: await page.getByLabel("School grade").locator("option:checked").textContent(),
      level: await page.getByLabel("Learning level").locator("option:checked").textContent(),
    };
  };
  const leoBefore = await leoProfile();
  expect(leoBefore).toMatchObject({ name: "Leo", grade: expect.stringMatching(/Kindergarten 2/) });

  await page.goto(`/parent/children/${mia}`);
  await page.getByLabel("Child's first name or nickname").fill("Mia Rose");
  await page.getByLabel("School grade").selectOption({ label: "🌳 Kindergarten 3 (ages 5–6)" });
  await page.getByLabel("Learning level").selectOption({ label: "🌿 Kindergarten 2" });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/parent/dashboard\\?child=${mia}`));
  await expect(page.getByText(/Kindergarten 3 · learning at Kindergarten 2/)).toBeVisible();

  // Editing Mia changed nothing about Leo.
  expect(await leoProfile()).toEqual(leoBefore);

  await page.goto(`/parent/children/${mia}`);
  await page.getByRole("button", { name: "Delete Mia Rose…" }).click();
  await page.getByLabel("Type Mia Rose to confirm").fill("Mia Rose");
  await page.getByRole("button", { name: "Delete Mia Rose", exact: true }).click();
  await expect(page).toHaveURL(/\/parent\/dashboard/);
  await expect(page.getByRole("heading", { level: 1, name: "Leo" })).toBeVisible();
  await page.goto(`/parent/children/${mia}`);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("the child area never trusts a child id from the browser", async ({ browser }) => {
  const familyA = await browser.newContext();
  const pageA = await familyA.newPage();
  await registerParent(pageA, "Parent A");
  const childA = await addChild(pageA, "Aya", /Kindergarten 1/);

  const familyB = await browser.newContext();
  const pageB = await familyB.newPage();
  await registerParent(pageB, "Parent B");
  await addChild(pageB, "Ben", /Kindergarten 2/);

  // Forge the active-child cookie with another family's child id.
  await familyB.addCookies([{ name: "el_active_child", value: childA, url: "http://127.0.0.1:3000" }]);
  await pageB.goto("/child/home");
  await expect(pageB).toHaveURL(/\/parent\/dashboard/);
  await expect(pageB.getByText("Aya")).toHaveCount(0);

  // Garbage in the cookie is equally harmless.
  await familyB.addCookies([
    { name: "el_active_child", value: "not-a-uuid--drop-table", url: "http://127.0.0.1:3000" },
  ]);
  await pageB.goto("/child/home");
  await expect(pageB).toHaveURL(/\/parent\/dashboard/);

  await Promise.all([familyA.close(), familyB.close()]);
});

test("a new family starts with onboarding and cannot skip it", async ({ page }) => {
  await registerParent(page);
  await page.goto("/parent/dashboard");
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole("button", { name: "Add child" }).click();
  await expect(page.getByText("Enter a name.")).toBeVisible();
  await expect(page.getByText("Choose a grade.")).toBeVisible();
});
