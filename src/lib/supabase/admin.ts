import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getServerEnv, publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

// Service-role client: bypasses RLS. Used only by the progress writer
// (src/lib/server/progress-writer.ts) AFTER it has verified, with the user's own
// RLS-scoped client, that the child belongs to the signed-in parent. Never import this
// from a Client Component or pass its results to one unfiltered.
let adminClient: ReturnType<typeof createClient<Database>> | null = null;

export function createAdminClient() {
  adminClient ??= createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    getServerEnv().SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  return adminClient;
}
