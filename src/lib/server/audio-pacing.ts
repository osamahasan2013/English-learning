import "server-only";
import { cache } from "react";
import { resolveAudioPacing, type AudioPacing } from "@/lib/audio/pacing";
import { DEFAULT_RULES } from "@/lib/learning/rules";
import { logger } from "@/lib/logging";
import { loadLearningRules } from "@/lib/server/learning-rules";
import { createClient } from "@/lib/supabase/server";

// The speech pacing for a level (the `audio` learning rules, with any override), for the
// screens outside a lesson: the child layout provides it to every Listen button. A lesson
// carries its own (lesson payload). Falls back to the defaults rather than failing a page.
export const getAudioPacing = cache(async (levelId: string | null): Promise<AudioPacing> => {
  try {
    const supabase = await createClient();
    const [rules, level] = await Promise.all([
      loadLearningRules(supabase),
      levelId
        ? supabase.from("levels").select("code").eq("id", levelId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    return resolveAudioPacing(rules.audio, level.data?.code ?? null);
  } catch (error) {
    logger.warn("audio_pacing.load_failed", { reason: error instanceof Error ? error.name : "unknown" });
    return resolveAudioPacing(DEFAULT_RULES.audio, null);
  }
});
