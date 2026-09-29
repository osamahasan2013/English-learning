import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

// Server Components / Route Handlers / Server Actions client, authenticated by the
// user's session cookie. Everything it does is subject to RLS.
export async function createClient() {
  // Read cookies first: it marks the route as per-request, so an unconfigured build treats
  // these pages as dynamic instead of failing to prerender them.
  const cookieStore = await cookies();
  const env = getPublicEnv();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; proxy.ts already refreshed the session.
        }
      },
    },
  });
}
