import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a real Supabase-compatible backend (auth, PostgREST, RLS):
// `npx supabase start` or the Docker-free `npm run stack:start`, with content imported
// (`npm run content:import`). They read NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY from .env.local to look up answers and verify stored data.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  // Every spec runs on a tablet (the main target); the child vertical slices also run on
  // a phone and a desktop.
  projects: [
    { name: "tablet", use: { ...devices["iPad (gen 7) landscape"], browserName: "chromium" } },
    {
      name: "mobile",
      testMatch: /(phonics|vertical-slice|vocabulary|spelling)\.spec\.ts/,
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    {
      name: "desktop",
      testMatch: /(phonics|vertical-slice|vocabulary|spelling)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: process.env.E2E_PROD
      ? "npm run start -- --hostname 127.0.0.1 --port 3000"
      : "npm run dev -- --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
