import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicEnv, getServerEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

// Service-role client: bypasses RLS. Used only by
//   * the progress writer (src/lib/server/progress-writer.ts), AFTER the sync route has
//     verified with the user's own RLS-scoped client that the child is theirs (the route
//     also uses it to tell a deleted child — no row at all — from another family's), and
//   * the lesson loader (src/lib/server/lesson-loader.ts), to read the answers of the
//     published questions RLS already returned, which it turns into digest-only answer
//     keys (signed-in users have no SELECT on questions.answer; ADR-021), and
//   * the child lifecycle operations (src/lib/server/child-lifecycle.ts): delete a child
//     and reset a child's learning, AFTER the parent's own RLS-scoped client has shown the
//     child is theirs; the database functions check the parent id again (ADR-046).
// Never import this from a Client Component or pass its results to one unfiltered.
let adminClient: ReturnType<typeof createClient<Database>> | null = null;

export function createAdminClient() {
  adminClient ??= createClient<Database>(
    getPublicEnv().NEXT_PUBLIC_SUPABASE_URL,
    getServerEnv().SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  return adminClient;
}
