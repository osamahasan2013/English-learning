import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type Client = SupabaseClient<Database>;

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

// A fresh, signed-out client using the public anon key (what the browser has).
export function anonClient(): Client {
  return createClient<Database>(url(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options);
}

// Service role: fixtures and verification only.
export function serviceClient(): Client {
  return createClient<Database>(url(), process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
}

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

export const PASSWORD = "correct-horse-battery";

// Registers a parent and returns a client signed in as them.
export async function registerParent(name = "Test Parent", timezone = "Europe/London") {
  const client = anonClient();
  const email = uniqueEmail("int-parent");
  const { data, error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { data: { display_name: name, timezone } },
  });
  if (error || !data.session || !data.user) throw error ?? new Error("sign-up returned no session");
  return { client, email, userId: data.user.id };
}

export async function levelId(client: Client, code: string) {
  const { data, error } = await client.from("levels").select("id").eq("code", code).single();
  if (error) throw error;
  return data.id;
}
