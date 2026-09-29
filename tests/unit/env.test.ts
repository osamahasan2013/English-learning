import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConfigurationError,
  getPublicEnv,
  getServerEnv,
  isServerConfigured,
  isSupabaseConfigured,
  publicConfigurationProblems,
} from "@/lib/env";

afterEach(() => vi.unstubAllEnvs());

describe("environment configuration", () => {
  it("reports missing public settings by name, without throwing on import", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(isSupabaseConfigured()).toBe(false);
    expect(publicConfigurationProblems().join(" ")).toMatch(
      /NEXT_PUBLIC_SUPABASE_URL.*NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    );
    expect(() => getPublicEnv()).toThrow(ConfigurationError);
  });

  it("rejects a URL that is not a URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    expect(publicConfigurationProblems()).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL must be the Supabase project URL",
    ]);
  });

  it("returns valid settings", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    expect(getPublicEnv()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    });
  });

  it("never exposes values in error messages", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "secret-looking-value");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    expect(() => getPublicEnv()).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("secret-looking-value") }),
    );
  });

  it("keeps the service-role key out of the browser", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    // jsdom defines window, like a browser bundle would.
    expect(() => getServerEnv()).toThrow(/never run in the browser/);
  });

  it("requires the service-role key for server features", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(isServerConfigured()).toBe(false);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    expect(isServerConfigured()).toBe(true);
  });
});
