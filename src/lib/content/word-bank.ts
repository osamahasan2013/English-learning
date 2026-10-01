import type { WordInput } from "@/lib/content/content-schemas";
import type { TemplateSegment, TemplateWord } from "@/lib/content/templates";

// Builds the word-bank entries that question templates read (TemplateWord), from an
// imported word (CSV/JSON) — shared by the importer and the content tests, so both see the
// same facts. The importer builds the same shape from database rows for curriculum-only
// imports (ContentImporter.loadBanksFromDatabase).

export type CategoryRef = { code: string; name: string; emoji: string; parent: string | null };

// Written forms that count as the word itself in a sentence (dog → dogs; run → running).
export function wordForms(word: { plural?: string; inflections?: Record<string, string> }) {
  return [...new Set([word.plural ?? "", ...Object.values(word.inflections ?? {})].filter(Boolean))];
}

export function categoryFacts(code: string | null | undefined, categories: Map<string, CategoryRef>) {
  if (!code) return { category: null, topCategory: null };
  const category = categories.get(code);
  const top = category?.parent ? categories.get(category.parent) : category;
  return {
    category: code,
    topCategory: top?.code ?? code,
    topCategoryName: top?.name ?? code,
    topCategoryEmoji: top?.emoji ?? "",
  };
}

export function templateWordFromInput(
  w: WordInput,
  segments: TemplateSegment[],
  refs: { categories: Map<string, CategoryRef>; levelRanks: Map<string, number> },
): TemplateWord {
  return {
    word: w.word,
    emoji: w.emoji,
    childDefinition: w.childDefinition,
    patterns: w.patterns.map((p) => ({ code: p.code, sound: p.sound })),
    segments,
    ...categoryFacts(w.subcategory ?? w.category, refs.categories),
    levelRank: refs.levelRanks.get(w.level),
    partOfSpeech: w.partOfSpeech,
    difficulty: w.difficulty,
    syllables: w.syllables,
    published: w.status === "published",
    examples: [w.exampleSentence, ...w.examples].filter(Boolean),
    synonyms: w.synonyms,
    forms: wordForms(w),
  };
}
