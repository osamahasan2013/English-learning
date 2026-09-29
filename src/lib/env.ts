import { z } from "zod";

// Configuration is validated on first use, not at import time, so the app can be built
// (and CI can run) before a Supabase project exists. An unconfigured deployment shows a
// "setup required" screen (see app/layout.tsx) instead of crashing.
//
// NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time, so they must be
// set when running `npm run build`, and they must be referenced literally below.

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("must be the Supabase project URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "is required"),
});
export type PublicEnv = z.infer<typeof publicEnvSchema>;

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "is required on the server"),
});
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class ConfigurationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Missing or invalid configuration: ${problems.join("; ")}. See .env.example.`);
    this.name = "ConfigurationError";
  }
}

function describe(error: z.ZodError) {
  return error.issues.map((i) => `${i.path.join(".")} ${i.message}`);
}

function parsePublicEnv() {
  return publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export function isSupabaseConfigured() {
  return parsePublicEnv().success;
}

// The names of missing/invalid public settings, for the setup screen (never the values).
export function publicConfigurationProblems() {
  const parsed = parsePublicEnv();
  return parsed.success ? [] : describe(parsed.error);
}

export function getPublicEnv(): PublicEnv {
  const parsed = parsePublicEnv();
  if (!parsed.success) throw new ConfigurationError(describe(parsed.error));
  return parsed.data;
}

// Server-only secrets. Throws in a browser bundle as a safety net.
export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("getServerEnv() must never run in the browser");
  }
  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!parsed.success) throw new ConfigurationError(describe(parsed.error));
  return parsed.data;
}

export function isServerConfigured() {
  return (
    isSupabaseConfigured() &&
    serverEnvSchema.safeParse({ SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY }).success
  );
}
