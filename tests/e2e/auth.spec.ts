import { expect, test } from "@playwright/test";
import { addChild, admin, registerParent } from "./helpers";

const PASSWORD = "correct-horse-battery";

test("a parent registers, logs out, and logs back in", async ({ page }) => {
  const email = await registerParent(page, "Nadia");
  await addChild(page, "Mia", /Kindergarten 2/);

  // The session survives a reload and is shared with a new tab.
  await page.reload();
  await expect(page).toHaveURL(/\/parent\/dashboard/);
  await expect(page.getByRole("heading", { level: 1, name: "Mia" })).toBeVisible();
  const tab = await page.context().newPage();
  await tab.goto("/parent/children");
  await expect(tab).toHaveURL(/\/parent\/children$/);
  await expect(tab.getByRole("heading", { name: "Mia" })).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("/");

  // Logging out ends the session everywhere, including the other tab.
  await tab.reload();
  await expect(tab).toHaveURL(/\/login\?next=%2Fparent%2Fchildren/);
  await tab.close();

  // Protected pages now send the visitor to log in, remembering where they were going.
  await page.goto("/parent/children");
  await expect(page).toHaveURL(/\/login\?next=%2Fparent%2Fchildren/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/parent\/children$/);
  await expect(page.getByRole("heading", { name: "Mia" })).toBeVisible();
});

test("a wrong password is refused without saying whether the email exists", async ({ page }) => {
  const email = await registerParent(page);
  await page.getByRole("button", { name: "Log out" }).click();

  for (const tryEmail of [email, "nobody-here@example.com"]) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(tryEmail);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Log in" }).click();
    // (Next.js's route announcer is also an alert; pick ours by its text.)
    await expect(
      page.getByRole("alert").filter({ hasText: "That email and password don't match an account" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  }
});

test("signed-in parents are kept away from the login page, signed-out ones from the app", async ({
  page,
}) => {
  await page.goto("/parent/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/child/home");
  await expect(page).toHaveURL(/\/login/);

  await registerParent(page);
  await page.goto("/login");
  await expect(page).not.toHaveURL(/\/login/);
});

test("a parent resets a forgotten password", async ({ page }) => {
  const email = await registerParent(page);
  await page.getByRole("button", { name: "Log out" }).click();

  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toHaveText(/If an account exists for that email/);

  // A broken or expired link explains itself.
  await page.goto("/auth/confirm?token_hash=not-a-real-token&type=recovery&next=/update-password");
  await expect(page.getByText("That link didn't work")).toBeVisible();

  // Stand-in for opening the emailed link: the same one-time token, generated server-side.
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  expect(error).toBeNull();
  await page.goto(
    `/auth/confirm?token_hash=${data.properties!.hashed_token}&type=recovery&next=/update-password`,
  );
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();

  await page.getByLabel("New password", { exact: true }).fill("a-brand-new-password");
  await page.getByLabel("Repeat new password").fill("something-else");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByText("The passwords don't match.")).toBeVisible();

  await page.getByLabel("New password", { exact: true }).fill("a-brand-new-password");
  await page.getByLabel("Repeat new password").fill("a-brand-new-password");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page).toHaveURL(/\/onboarding|\/parent\/dashboard/);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-brand-new-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
});

test("a parent edits their profile and time zone", async ({ page }) => {
  await registerParent(page, "Old Name");
  await addChild(page, "Mia", /Kindergarten 1/);
  await page.getByRole("link", { name: "Settings" }).click();

  await page.getByLabel("Your name").fill("New Name");
  await page.getByLabel("Time zone").selectOption("Asia/Dubai");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profile saved." })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Your name")).toHaveValue("New Name");
  await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Dubai");
});
