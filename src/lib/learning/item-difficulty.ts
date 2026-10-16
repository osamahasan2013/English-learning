// Item difficulty, 1–10 (Phase 9): a meaningful, documented number for choosing assessment
// items in a range — not a random score. Pure; used by the importer (authored assessment
// items, stored in assessment_items.difficulty) and by the server for lesson questions drawn
// into dynamic assessments.
//
//   base      the level: KG1 1 · KG2 3 · KG3 5 · Grade 1 7 · Grade 2 9
//   demand    the task's cognitive demand: recognising (choose, match) +0, building or
//             ordering (word builder, sorting, segmenting, sequencing) +1, producing
//             (spelling, writing, tracing from memory) +1
//   features  word features where known: longer words (6+ letters) +1, an irregular word +1
//   authored  a question's own difficulty (questions.difficulty, 1–10) above 1 replaces the
//             feature part: the author knew better
// The result is clamped to 1–10.

const BUILD = new Set([
  "WORD_BUILDER",
  "SENTENCE_BUILDER",
  "SORT",
  "SEGMENT_WORD",
  "ORDER_EVENTS",
  "DRAG_DROP",
  "MATCH",
]);
const PRODUCE = new Set([
  "SPELLING",
  "WRITING",
  "SENTENCE_DICTATION",
  "TRACING",
  "EDIT_AND_CORRECT",
  "MISSING_LETTER",
]);

export function itemDifficulty(args: {
  levelRank: number;
  questionType: string;
  authored?: number | null;
  word?: string | null;
  irregular?: boolean;
}): number {
  const base = 1 + 2 * (Math.max(1, Math.min(5, args.levelRank)) - 1);
  const demand = BUILD.has(args.questionType) || PRODUCE.has(args.questionType) ? 1 : 0;
  let features = 0;
  if (args.authored && args.authored > 1) features = Math.min(2, Math.round((args.authored - 1) / 4));
  else {
    if (args.word && args.word.replace(/[^a-z]/gi, "").length >= 6) features += 1;
    if (args.irregular) features += 1;
  }
  return Math.max(1, Math.min(10, base + demand + features));
}
