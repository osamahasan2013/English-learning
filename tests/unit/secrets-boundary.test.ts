import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The service-role client and key never reach browser code: the admin client is
// server-only (a build error if a client component imports it), no client module imports
// it or a server-only loader, and only env.ts and the admin client touch the key.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
const sources = files("src").map((file) => ({ file, text: readFileSync(file, "utf8") }));
const isClient = (text: string) => /^\s*["']use client["']/.test(text);

describe("secrets boundary", () => {
  it("the service-role client is server-only", () => {
    const admin = readFileSync("src/lib/supabase/admin.ts", "utf8");
    expect(admin).toMatch(/^import "server-only";/);
  });

  it("no client module imports the service-role client or a server-only loader", () => {
    const offenders = sources
      .filter((s) => isClient(s.text))
      .filter((s) => /from "@\/lib\/supabase\/admin"|from "@\/lib\/server\//.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it("only the env module and the server-only admin client touch the service-role key", () => {
    const readers = sources.filter((s) => s.text.includes("SUPABASE_SERVICE_ROLE_KEY")).map((s) => s.file);
    expect(readers.sort()).toEqual([
      path.join("src", "lib", "env.ts"),
      path.join("src", "lib", "supabase", "admin.ts"),
    ]);
    // The admin client goes through the validated server env, never process.env directly.
    expect(readFileSync("src/lib/supabase/admin.ts", "utf8")).not.toMatch(/process\.env/);
    const env = readFileSync("src/lib/env.ts", "utf8");
    // Never a NEXT_PUBLIC_ variable (those are inlined into the browser bundle).
    expect(env).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SERVICE/);
  });
});
