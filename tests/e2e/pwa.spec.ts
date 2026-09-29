import { expect, test } from "@playwright/test";
import { addChild, registerParent } from "./helpers";

// PWA shell: installable manifest, service worker, and a previously opened lesson that
// reopens with no network. The service worker is only registered in production builds,
// so run this with E2E_PROD=1 after `npm run build`.
test.skip(!process.env.E2E_PROD, "service worker is only registered in production builds");

test("the app is installable and a visited lesson reopens offline", async ({ page, context }) => {
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);

  await registerParent(page);
  await addChild(page, "Noor", /Kindergarten 1/);
  await page.getByRole("button", { name: /Start learning as Noor/ }).click();
  await expect(page).toHaveURL(/\/child\/home/);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));

  await page.getByRole("link", { name: /Next/ }).click();
  await page.locator("section[data-question-id]").waitFor();
  const lessonUrl = page.url();
  // A full load while the worker controls the page stores the page for offline use.
  await page.goto(lessonUrl);
  // .first(): while streaming, Next.js briefly holds the page in a hidden container too.
  await page.locator("section[data-question-id]").first().waitFor();

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("section[data-question-id]").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Listen/ }).first()).toBeVisible();
  await expect(page.getByText("Offline")).toBeVisible();
  await context.setOffline(false);
});
