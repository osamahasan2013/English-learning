import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    // tests/integration needs a running backend: npm run test:integration.
    css: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
      // Server modules import "server-only", which throws outside a React Server
      // environment; tests exercise those modules directly.
      "server-only": path.resolve(dirname, "./tests/server-only-stub.ts"),
    },
  },
});
