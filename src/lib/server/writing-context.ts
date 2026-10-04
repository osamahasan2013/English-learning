import "server-only";

import type { LearningRules } from "@/lib/learning/rules";
import type { TraceGlyph } from "@/lib/learning/tracing";
import {
  resolveWritingSettings,
  WRITING_QUESTION_TYPES,
  type WritingContext,
} from "@/lib/learning/writing-evaluation";
import { glyphFromRow, GLYPH_COLUMNS, type GlyphRow } from "@/lib/server/glyphs";
import type { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

// What the server needs to judge written answers (progress-writer.ts): the level's writing
// settings (from the question's skill → unit → level), the glyph of a handwriting question
// and, for open-ended writing, the known words (spelling and spacing checks).

export type WritingQuestionFacts = {
  id: string;
  question_type: string;
  glyph_id: string | null;
  level_code: string | null;
};

const RUBRIC_TYPES = new Set(["SENTENCE_WRITING", "GUIDED_WRITING", "STORY_ORDER_WRITING"]);
const LEXICON_TTL_MS = 10 * 60 * 1000;
let lexiconCache: { at: number; words: Set<string> } | null = null;

// Published word-bank words (each word of a multi-word entry) and their regular endings,
// cached for a few minutes. Only used to point out spelling, never to fail an answer.
async function loadLexicon(db: Db): Promise<Set<string>> {
  if (lexiconCache && Date.now() - lexiconCache.at < LEXICON_TTL_MS) return lexiconCache.words;
  const words = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("words")
      .select("normalized_word")
      .eq("status", "published")
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? [])
      for (const w of row.normalized_word.split(/[^a-z']+/)) {
        if (!w) continue;
        words.add(w);
        if (w.length > 2) for (const ending of ["s", "es", "ed", "ing"]) words.add(w + ending);
      }
    if (!data || data.length < 1000) break;
  }
  lexiconCache = { at: Date.now(), words };
  return words;
}

export async function loadWritingContexts(
  db: Db,
  questions: WritingQuestionFacts[],
  rules: LearningRules,
): Promise<Map<string, Omit<WritingContext, "content">>> {
  const out = new Map<string, Omit<WritingContext, "content">>();
  const writing = questions.filter((q) => WRITING_QUESTION_TYPES.has(q.question_type));
  if (writing.length === 0) return out;

  const glyphIds = [...new Set(writing.map((q) => q.glyph_id).filter((id): id is string => !!id))];
  const glyphs = new Map<string, TraceGlyph>();
  if (glyphIds.length > 0) {
    const { data, error } = await db
      .from("handwriting_glyphs")
      .select(GLYPH_COLUMNS)
      .in("id", glyphIds)
      .eq("status", "published");
    if (error) throw error;
    for (const row of (data ?? []) as GlyphRow[]) {
      const glyph = glyphFromRow(row);
      if (glyph) glyphs.set(row.id, glyph);
    }
  }
  const lexicon = writing.some((q) => RUBRIC_TYPES.has(q.question_type)) ? await loadLexicon(db) : undefined;

  for (const q of writing) {
    out.set(q.id, {
      settings: resolveWritingSettings(q.level_code, rules.writing),
      glyph: q.glyph_id ? (glyphs.get(q.glyph_id) ?? null) : null,
      lexicon: RUBRIC_TYPES.has(q.question_type) ? lexicon : undefined,
    });
  }
  return out;
}
