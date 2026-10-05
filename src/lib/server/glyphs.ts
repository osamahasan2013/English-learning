import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { glyphGuideSchema, glyphStrokesSchema, type TraceGlyph } from "@/lib/learning/tracing";
import { logger } from "@/lib/logging";
import type { Database } from "@/lib/supabase/types";

// Handwriting glyphs (handwriting_glyphs) as the tracing engine sees them. The same row
// shape is read by the lesson loader (the parent's RLS client: published glyphs) and the
// progress writer (service role, to evaluate the strokes of a stored answer).

export const GLYPH_COLUMNS =
  "id, code, kind, character, letter_case, name, strokes, guide, tolerance, completion, formation_tip, formation_speech, confusable_codes";

export type GlyphRow = {
  id: string;
  code: string;
  kind: string;
  character: string;
  letter_case: string;
  name: string;
  strokes: unknown;
  guide: unknown;
  tolerance: number | string;
  completion: number | string;
  formation_tip: string;
  formation_speech: string;
  confusable_codes?: string[] | null;
};

// null (and a log line) when the stored strokes are malformed: such a glyph is never traced.
export function glyphFromRow(row: GlyphRow): TraceGlyph | null {
  const strokes = glyphStrokesSchema.safeParse(row.strokes);
  const guide = glyphGuideSchema.safeParse(row.guide ?? {});
  if (!strokes.success || !guide.success) {
    logger.warn("glyph.invalid", { glyph: row.code });
    return null;
  }
  return {
    code: row.code,
    kind: row.kind as TraceGlyph["kind"],
    character: row.character,
    letterCase: row.letter_case as TraceGlyph["letterCase"],
    name: row.name,
    strokes: strokes.data,
    guide: guide.data,
    tolerance: Number(row.tolerance),
    completion: Number(row.completion),
    formationTip: row.formation_tip,
    formationSpeech: row.formation_speech,
  };
}

// Attaches each glyph's confusables (their published reference strokes) so the trace can be
// told apart from them (tracing.ts → identityCheck). One query for the whole set. Works
// with the parent's RLS client (lesson payloads) and the service role (progress writer);
// either way the data is published reference content, never the child's.
export async function attachConfusables(
  db: SupabaseClient<Database>,
  glyphs: { glyph: TraceGlyph; codes: string[] }[],
): Promise<void> {
  const wanted = [...new Set(glyphs.flatMap((g) => g.codes))];
  if (wanted.length === 0) return;
  const { data, error } = await db
    .from("handwriting_glyphs")
    .select(GLYPH_COLUMNS)
    .in("code", wanted)
    .eq("status", "published");
  if (error) throw error;
  const byCode = new Map<string, TraceGlyph>();
  for (const row of (data ?? []) as GlyphRow[]) {
    const glyph = glyphFromRow(row);
    if (glyph) byCode.set(glyph.code, glyph);
  }
  for (const { glyph, codes } of glyphs)
    glyph.confusables = codes.flatMap((code) => {
      const other = byCode.get(code);
      return other ? [{ code: other.code, name: other.name, strokes: other.strokes }] : [];
    });
}
