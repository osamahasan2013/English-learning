import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { addChild, registerParent, startLesson } from "./helpers";

// PWA shell: installable manifest, service worker, a previously opened lesson that reopens
// without a connection, and the static offline page for everything else.
//
// "Offline" here means the server is really gone: this test runs its own production server
// and kills it. Playwright's setOffline() does not reliably block requests the service
// worker itself makes (navigation preload), so it cannot prove what came from the cache.
// The service worker is only registered in production builds: run with E2E_PROD=1 after
// `npm run build`.
test.skip(!process.env.E2E_PROD, "service worker is only registered in production builds");

const PORT = 3200;
const ORIGIN = `http://127.0.0.1:${PORT}`;
test.use({ baseURL: ORIGIN });

let server: ChildProcess | null = null;

function startServer() {
  server = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: path.resolve(__dirname, "../.."),
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
}

function stopServer() {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  server = null;
}

test.beforeAll(async () => {
  startServer();
  await expect
    .poll(
      () =>
        fetch(ORIGIN)
          .then((r) => r.status)
          .catch(() => 0),
      { timeout: 60_000 },
    )
    .toBe(200);
});
test.afterAll(stopServer);

test("the app is installable, a visited lesson reopens offline, and other pages fall back", async ({
  page,
  context,
}) => {
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
  await startLesson(page);
  const lessonUrl = page.url();
  // A full load while the worker controls the page stores the page for offline use.
  await page.goto(lessonUrl);
  // .first(): while streaming, Next.js briefly holds the page in a hidden container too.
  await page.getByRole("button", { name: "Start" }).first().waitFor();

  // The server goes away (wait until it really refuses connections: fromServiceWorker() is
  // also true when the worker passes a request through to a still-running server).
  stopServer();
  await expect
    .poll(
      () =>
        fetch(ORIGIN)
          .then(() => "up")
          .catch(() => "down"),
      { timeout: 15_000 },
    )
    .toBe("down");
  await context.setOffline(true);

  const lesson = await page.reload();
  expect(lesson?.fromServiceWorker()).toBe(true);
  // The lesson starts and runs with no connection at all.
  await page.getByRole("button", { name: "Start" }).first().click();
  await expect(page.locator("section[data-question-id]").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Listen/ }).first()).toBeVisible();
  await expect(page.getByText("Offline")).toBeVisible();

  // A page never opened or prefetched on this device (nothing links to this URL) gets the
  // static offline page instead of a browser error.
  const fallback = await page.goto("/parent/children/00000000-0000-4000-8000-000000000000");
  expect(fallback?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
});
