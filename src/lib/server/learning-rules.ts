import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logging";
import { mergeLearningRules, type LearningRules } from "@/lib/learning/rules";
import type { Database } from "@/lib/supabase/types";

// Loads the engine rules (defaults merged with the learning_rules table). Works with
// either the parent's RLS client (rules are readable by everyone signed in) or the
// service-role client used by the progress writer.
export async function loadLearningRules(db: SupabaseClient<Database>): Promise<LearningRules> {
  const { data, error } = await db.from("learning_rules").select("code, config");
  if (error) throw error;
  const { rules, errors } = mergeLearningRules(data ?? []);
  if (errors.length > 0) logger.warn("rules.invalid_override", { count: errors.length, reason: errors[0] });
  return rules;
}
