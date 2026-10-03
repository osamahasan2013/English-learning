import "server-only";
import { cache } from "react";
import { getPublicEnv } from "@/lib/env";
import { publicAudioUrl } from "@/lib/content/media";
import { logger } from "@/lib/logging";
import {
  buildSoundTable,
  EMPTY_SOUND_TABLE,
  type SoundRow,
  type SoundTable,
} from "@/lib/audio/pronunciation";
import { createClient } from "@/lib/supabase/server";

// The sound table for speech tokens ({/S/} sounds, {@s} letter names): the phoneme
// inventory, multi-sound pattern renderings ("shun", "ing"), letter names and any
// recorded clips. Small (≈70 entries) and the same for every child; built once per
// request. See src/lib/audio/pronunciation.ts.

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Asset = { storage_path: string; status: string } | { storage_path: string; status: string }[] | null;

function assetUrl(asset: Asset, base: string | null) {
  const a = Array.isArray(asset) ? asset[0] : asset;
  return a && a.status === "published" && a.storage_path && base
    ? publicAudioUrl(base, a.storage_path)
    : null;
}

export async function loadSoundTable(supabase: Supabase): Promise<SoundTable> {
  let base: string | null = null;
  try {
    base = getPublicEnv().NEXT_PUBLIC_SUPABASE_URL;
  } catch {
    base = null;
  }
  const [phonemes, sounds, letters] = await Promise.all([
    supabase
      .from("phonemes")
      .select(
        "code, say_as, tts_quality, keyword, keyword_position, sort_order, audio_assets(storage_path, status)",
      )
      .order("sort_order"),
    supabase
      .from("phonics_pattern_sounds")
      .select(
        "phonemes, say_as, tts_quality, keyword, keyword_position, is_primary, audio_assets(storage_path, status), phonics_patterns!inner(status, audio_assets(storage_path, status))",
      )
      .eq("phonics_patterns.status", "published"),
    supabase
      .from("phonics_patterns")
      .select("pattern, letter_name_say_as")
      .eq("pattern_type", "letter")
      .eq("status", "published"),
  ]);
  const error = phonemes.error ?? sounds.error ?? letters.error;
  if (error) {
    // Without the table, tokens are simply not spoken (never spoken as letters).
    logger.error("sound_table.load_failed", { code: error.code });
    return EMPTY_SOUND_TABLE;
  }
  const rows: SoundRow[] = [
    ...(phonemes.data ?? []).map((p) => ({
      phonemes: [p.code],
      tts: p.say_as,
      quality: p.tts_quality as SoundRow["quality"],
      keyword: p.keyword || null,
      keywordPosition: p.keyword_position as SoundRow["keywordPosition"],
      assetUrl: assetUrl(p.audio_assets as Asset, base),
    })),
    ...(sounds.data ?? []).map((s) => {
      const pattern = Array.isArray(s.phonics_patterns) ? s.phonics_patterns[0] : s.phonics_patterns;
      // A pattern's own recording is a recording of its main sound.
      const clip =
        assetUrl(s.audio_assets as Asset, base) ??
        (s.is_primary ? assetUrl((pattern?.audio_assets ?? null) as Asset, base) : null);
      // Single-sound patterns use the phoneme's rendering; they only add a clip.
      const own = s.phonemes.length > 1 && (s.say_as || s.keyword);
      return {
        phonemes: s.phonemes,
        tts: own ? s.say_as : "",
        quality: (own ? s.tts_quality : "approximate") as SoundRow["quality"],
        keyword: own ? s.keyword || null : null,
        keywordPosition: s.keyword_position as SoundRow["keywordPosition"],
        assetUrl: clip,
      };
    }),
  ];
  return buildSoundTable(
    rows,
    (letters.data ?? []).map((l) => ({ letter: l.pattern, name: l.letter_name_say_as })),
  );
}

// Once per request, however many components ask.
export const getSoundTable = cache(async () => loadSoundTable(await createClient()));
