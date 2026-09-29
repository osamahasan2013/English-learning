import { z } from "zod";

// Fails fast with a clear message when required configuration is missing, instead of a
// confusing error deep inside a Supabase call. NEXT_PUBLIC_* values are inlined at build
// time, so they must be referenced literally here.
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be the Supabase project URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
});

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required on the server"),
});

let cachedServerEnv: z.infer<typeof serverEnvSchema> | null = null;

// Server-only secrets, validated on first use. Throws if ever called in a browser bundle.
export function getServerEnv() {
  if (typeof window !== "undefined") {
    throw new Error("getServerEnv() must never run in the browser");
  }
  cachedServerEnv ??= serverEnvSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  return cachedServerEnv;
}
