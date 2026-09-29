import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Integration tests talk to a real Supabase-compatible backend (auth server + PostgREST +
// Postgres with the migrations applied): `npm run stack:start` or a Supabase project.
// Configuration comes from .env.local. Run with `npm run test:integration`.
const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    testTimeout: 30_000,
    // Tests create their own uniquely named users; files can run in parallel.
    fileParallelism: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
      "server-only": path.resolve(dirname, "./tests/server-only-stub.ts"),
    },
  },
});
