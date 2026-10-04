import "server-only";

import { glyphGuideSchema, glyphStrokesSchema, type TraceGlyph } from "@/lib/learning/tracing";
import { logger } from "@/lib/logging";

// Handwriting glyphs (handwriting_glyphs) as the tracing engine sees them. The same row
// shape is read by the lesson loader (the parent's RLS client: published glyphs) and the
// progress writer (service role, to evaluate the strokes of a stored answer).

export const GLYPH_COLUMNS =
  "id, code, kind, character, letter_case, name, strokes, guide, tolerance, completion, formation_tip, formation_speech";

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
