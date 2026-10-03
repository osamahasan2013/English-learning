import type { ReviewItemRow } from "@/lib/learning/review-queue";
import { DEFAULT_RULES, type ReadingLevelRules, type ReadingRules } from "@/lib/learning/rules";

// The reading engine's pure logic (Phase 7). Reading texts are stories; reading lessons are
// ordinary lessons; comprehension answers are ordinary attempts on skills tagged with a
// reading skill. This module only understands TEXT: splitting it into paragraphs, sentences
// and words, analysing it against the word bank (decodability, unknown words), scoring its
// difficulty, checking it fits a level, summarising reading sessions for parents and
// suggesting what to read next. No I/O; numbers come from rules.ts (`reading`).
//
// What is deliberately NOT here: words per minute, accuracy of reading aloud, pronunciation
// scores. Nothing in the app listens to the child read, so none of that can be measured
// honestly (docs/decisions.md, ADR-037).

// ---- Text ---------------------------------------------------------------------------------

export type WordToken = { text: string; normalized: string; start: number; end: number };

// Letters with inner apostrophes or hyphens ("don't", "Sam's", "ice-cream").
const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function normalizeReadingWord(word: string) {
  return word.normalize("NFKC").toLowerCase().replace(/’/g, "'");
}

export function tokenizeWords(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    tokens.push({
      text: m[0],
      normalized: normalizeReadingWord(m[0]),
      start: m.index!,
      end: m.index! + m[0].length,
    });
  }
  return tokens;
}

// Sentences end at . ! ? (plus closing quotes) followed by a space and a capital letter or an
// opening quote, so `"Look!" said Sam.` stays one sentence.
export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: string[] = [];
  const re = /[.!?]+["”’)]*\s+(?=["“‘(]?[\p{Lu}\p{N}])/gu;
  let last = 0;
  for (const m of clean.matchAll(re)) {
    const end = m.index! + m[0].trimEnd().length;
    out.push(clean.slice(last, end).trim());
    last = m.index! + m[0].length;
  }
  const rest = clean.slice(last).trim();
  if (rest) out.push(rest);
  return out;
}

export type ReadingSentence = { text: string; words: string[] };
export type ReadingParagraph = {
  sentences: ReadingSentence[];
  speaker?: string;
  emoji?: string;
};

export type ReadingPage = { text: string; emoji?: string; speaker?: string };

// A story's pages are its paragraphs (a dialogue line is a page with a speaker).
export function paragraphsOf(pages: readonly ReadingPage[]): ReadingParagraph[] {
  return pages.map((p) => ({
    sentences: splitSentences(p.text).map((s) => ({
      text: s,
      words: tokenizeWords(s).map((t) => t.normalized),
    })),
    ...(p.speaker ? { speaker: p.speaker } : {}),
    ...(p.emoji ? { emoji: p.emoji } : {}),
  }));
}

export function runningWords(paragraphs: readonly ReadingParagraph[]): string[] {
  return paragraphs.flatMap((p) => p.sentences.flatMap((s) => s.words));
}

export function wordCountOf(pages: readonly ReadingPage[]) {
  return runningWords(paragraphsOf(pages)).length;
}

// Base forms a regularly inflected word may come from, most likely first: looks → look,
// naps → nap, wishes → wish, babies → baby, filled → fill, liked → like, napped → nap,
// running → run, making → make. Only used when the written form itself is not in the word
// bank, and only accepted when the base form is (the caller checks).
export function baseFormCandidates(word: string): string[] {
  const out: string[] = [];
  const add = (w: string) => {
    if (w.length >= 2 && w !== word && !out.includes(w)) out.push(w);
  };
  const undouble = (stem: string) => (/([b-df-hj-np-tv-z])\1$/.test(stem) ? stem.slice(0, -1) : null);
  if (word.endsWith("'s")) add(word.slice(0, -2));
  if (word.endsWith("ies")) add(`${word.slice(0, -3)}y`);
  if (word.endsWith("es")) add(word.slice(0, -2));
  if (word.endsWith("s") && !word.endsWith("ss")) add(word.slice(0, -1));
  for (const ending of ["ed", "ing"]) {
    if (!word.endsWith(ending)) continue;
    const stem = word.slice(0, -ending.length);
    if (ending === "ed" && stem.endsWith("i")) add(`${stem.slice(0, -1)}y`);
    add(stem);
    add(`${stem}e`);
    const single = undouble(stem);
    if (single) add(single);
  }
  if (word.endsWith("er")) add(word.slice(0, -2));
  return out;
}

// ---- Analysis -----------------------------------------------------------------------------

// How a word of the text relates to what the child has been taught (decided by the importer
// from the word bank: the word's grapheme split against the phonics patterns taught up to
// the text's level, the sight-word lists, the word's irregular flag).
export type WordClass = {
  decodable: boolean;
  sight: boolean;
  irregular: boolean;
  // Phonics pattern codes the word's split uses.
  patterns: readonly string[];
};

export type TextStats = {
  paragraphs: number;
  sentences: number;
  words: number;
  uniqueWords: number;
  avgSentenceWords: number;
  longestSentence: number;
  avgWordLetters: number;
  decodable: number;
  sight: number;
  irregular: number;
  unknown: number;
};

export type AnalyzedWord = {
  normalized: string;
  occurrences: number;
  firstPosition: number;
  isDecodable: boolean;
  isSight: boolean;
  isIrregular: boolean;
  isTargetPattern: boolean;
  isFocus: boolean;
};

export type TextAnalysis = {
  stats: TextStats;
  words: AnalyzedWord[];
  // Words not in the word bank (never added silently; reported for review).
  unknownWords: string[];
  // Share of running words that are decodable or sight words (0–100).
  decodablePct: number;
};

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

export function analyzeText(args: {
  paragraphs: readonly ReadingParagraph[];
  classify: (normalized: string) => WordClass | null;
  targetPatterns?: readonly string[];
  focusWords?: readonly string[];
}): TextAnalysis {
  const running = runningWords(args.paragraphs);
  const sentenceLengths = args.paragraphs.flatMap((p) => p.sentences.map((s) => s.words.length));
  const targets = new Set((args.targetPatterns ?? []).map((p) => p.toUpperCase()));
  const focus = new Set((args.focusWords ?? []).map(normalizeReadingWord));
  const byWord = new Map<string, AnalyzedWord>();
  const unknown: string[] = [];
  let decodable = 0;
  let sight = 0;
  let irregular = 0;
  let unknownCount = 0;
  running.forEach((word, position) => {
    const cls = args.classify(word);
    if (!cls) {
      unknownCount++;
      if (!unknown.includes(word)) unknown.push(word);
      return;
    }
    if (cls.decodable) decodable++;
    else if (cls.sight) sight++;
    if (cls.irregular) irregular++;
    const seen = byWord.get(word);
    if (seen) seen.occurrences++;
    else
      byWord.set(word, {
        normalized: word,
        occurrences: 1,
        firstPosition: position,
        isDecodable: cls.decodable,
        isSight: cls.sight,
        isIrregular: cls.irregular,
        isTargetPattern: cls.patterns.some((p) => targets.has(p.toUpperCase())),
        isFocus: focus.has(word),
      });
  });
  const letters = running.reduce((n, w) => n + w.replace(/[^\p{L}]/gu, "").length, 0);
  const stats: TextStats = {
    paragraphs: args.paragraphs.length,
    sentences: sentenceLengths.length,
    words: running.length,
    uniqueWords: new Set(running).size,
    avgSentenceWords: sentenceLengths.length ? round(running.length / sentenceLengths.length) : 0,
    longestSentence: sentenceLengths.length ? Math.max(...sentenceLengths) : 0,
    avgWordLetters: running.length ? round(letters / running.length) : 0,
    decodable,
    sight,
    irregular,
    unknown: unknownCount,
  };
  return {
    stats,
    words: [...byWord.values()],
    unknownWords: unknown,
    decodablePct: running.length ? round(((decodable + sight) / running.length) * 100) : 0,
  };
}

// Difficulty 1–10 from the text's statistics, weighted by the reading rules. Authors may
// still set a story's difficulty by hand; the importer reports a big disagreement.
export function readingDifficulty(
  analysis: Pick<TextAnalysis, "stats" | "decodablePct">,
  rules: ReadingRules["difficulty"] = DEFAULT_RULES.reading.difficulty,
): number {
  const { stats } = analysis;
  const factors: [number, { weight: number; from: number; full: number }][] = [
    [stats.avgSentenceWords, rules.avgSentenceWords],
    [stats.avgWordLetters, rules.avgWordLetters],
    [stats.words, rules.totalWords],
    [100 - analysis.decodablePct, rules.nonDecodablePct],
  ];
  const totalWeight = factors.reduce((n, [, f]) => n + f.weight, 0);
  if (totalWeight === 0 || stats.words === 0) return 1;
  const scaled = (value: number, f: { from: number; full: number }) =>
    Math.max(0, Math.min(1, (value - f.from) / (f.full - f.from)));
  const score = factors.reduce((n, [value, f]) => n + f.weight * scaled(value, f), 0) / totalWeight;
  return Math.max(1, Math.min(10, Math.round(1 + score * 9)));
}

// Reading time estimate for a child at the level: a slow, comfortable pace (it sizes the
// lesson; it is not a fluency target).
export function estimatedReadingSeconds(words: number, levelRank: number) {
  const wordsPerMinute = [0, 10, 15, 25, 40, 60][Math.min(5, Math.max(1, levelRank))];
  return Math.max(10, Math.min(3600, Math.round((words / wordsPerMinute) * 60)));
}

// ---- Level fit ----------------------------------------------------------------------------

export type ReadingSkillRef = { code: string; minLevelRank: number };
export type ReadingContentTypeRef = { code: string; minLevelRank: number };
export type TextIssue = { severity: "error" | "warning"; rule: string; message: string };

// Checks a text against its level: size limits, decodability, unknown words, and that its
// content type and target skills are taught at this level (no inference in KG1).
export function checkTextForLevel(args: {
  levelCode: string;
  levelRank: number;
  analysis: TextAnalysis;
  contentType: ReadingContentTypeRef | null;
  skills: readonly (ReadingSkillRef | null)[];
  skillCodes: readonly string[];
  questionCount: number;
  rules?: ReadingRules;
}): TextIssue[] {
  const rules = args.rules ?? DEFAULT_RULES.reading;
  const level: ReadingLevelRules = rules.levels[args.levelCode] ?? rules.levels[rules.defaultLevel];
  const issues: TextIssue[] = [];
  const { stats } = args.analysis;
  const error = (rule: string, message: string) => issues.push({ severity: "error", rule, message });
  const warning = (rule: string, message: string) => issues.push({ severity: "warning", rule, message });
  if (!args.contentType) error("unknown_content_type", "unknown content type");
  else if (args.contentType.minLevelRank > args.levelRank)
    error("content_type_too_advanced", `${args.contentType.code} is not taught at ${args.levelCode}`);
  args.skills.forEach((skill, i) => {
    if (!skill) error("unknown_reading_skill", `unknown reading skill ${args.skillCodes[i]}`);
    else if (skill.minLevelRank > args.levelRank)
      error("skill_too_advanced", `${skill.code} is not taught at ${args.levelCode}`);
  });
  if (stats.words === 0) error("empty_text", "the text has no words");
  if (stats.paragraphs > level.maxParagraphs)
    error(
      "too_many_paragraphs",
      `${stats.paragraphs} paragraphs (max ${level.maxParagraphs} at ${args.levelCode})`,
    );
  if (stats.sentences > level.maxSentences)
    error(
      "too_many_sentences",
      `${stats.sentences} sentences (max ${level.maxSentences} at ${args.levelCode})`,
    );
  if (stats.longestSentence > level.maxSentenceWords)
    error(
      "sentence_too_long",
      `a sentence has ${stats.longestSentence} words (max ${level.maxSentenceWords} at ${args.levelCode})`,
    );
  if (args.analysis.unknownWords.length > 0)
    error("unknown_words", `words not in the word bank: ${args.analysis.unknownWords.join(", ")}`);
  if (stats.words > 0 && args.analysis.decodablePct < level.minDecodablePct)
    warning(
      "low_decodability",
      `${args.analysis.decodablePct}% decodable or sight words (expected ${level.minDecodablePct}%+ at ${args.levelCode})`,
    );
  if (args.questionCount < level.minQuestions || args.questionCount > level.maxQuestions)
    warning(
      "question_count",
      `${args.questionCount} comprehension questions (expected ${level.minQuestions}–${level.maxQuestions})`,
    );
  return issues;
}

// ---- Reading sessions ---------------------------------------------------------------------

export type ReadingSessionInput = {
  storyId: string;
  startedAt: string;
  durationMs: number;
  wordCount: number;
  listens: number;
  slowListens: number;
  rereads: number;
  helpWordIds: readonly string[];
  selfCheck: "easy" | "ok" | "hard" | null;
};

export type ReadingSummary = {
  readings: number;
  texts: number;
  totalSeconds: number;
  wordsRead: number;
  rereads: number;
  listens: number;
  // The child's own "how was it?" after reading.
  selfChecks: { easy: number; ok: number; hard: number };
  // Words tapped for help most often (word id → taps), most first.
  helpWords: { wordId: string; taps: number }[];
  lastReadAt: string | null;
};

// Parent-facing totals. Time is capped per reading (rules.maxCountedSeconds) so an open
// screen does not count as reading. No speed or accuracy figure: none is measured.
export function summarizeReadingSessions(
  sessions: readonly ReadingSessionInput[],
  rules: ReadingRules = DEFAULT_RULES.reading,
): ReadingSummary {
  const help = new Map<string, number>();
  const selfChecks = { easy: 0, ok: 0, hard: 0 };
  let totalMs = 0;
  let wordsRead = 0;
  let rereads = 0;
  let listens = 0;
  let last: string | null = null;
  for (const s of sessions) {
    totalMs += Math.min(s.durationMs, rules.maxCountedSeconds * 1000);
    wordsRead += s.wordCount;
    rereads += s.rereads;
    listens += s.listens + s.slowListens;
    if (s.selfCheck) selfChecks[s.selfCheck]++;
    for (const id of new Set(s.helpWordIds)) help.set(id, (help.get(id) ?? 0) + 1);
    if (!last || s.startedAt > last) last = s.startedAt;
  }
  return {
    readings: sessions.length,
    texts: new Set(sessions.map((s) => s.storyId)).size,
    totalSeconds: Math.round(totalMs / 1000),
    wordsRead,
    rereads,
    listens,
    selfChecks,
    helpWords: [...help.entries()]
      .map(([wordId, taps]) => ({ wordId, taps }))
      .sort((a, b) => b.taps - a.taps || a.wordId.localeCompare(b.wordId)),
    lastReadAt: last,
  };
}

// ---- Comprehension ------------------------------------------------------------------------

export type ComprehensionAttempt = {
  readingSkillCode: string | null;
  storyId: string | null;
  isCorrect: boolean;
};

export type SkillComprehension = { code: string; firstTries: number; correct: number; percent: number };

// First-try accuracy per reading skill (from ordinary attempts on tagged skills).
export function comprehensionBySkill(attempts: readonly ComprehensionAttempt[]): SkillComprehension[] {
  const by = new Map<string, { firstTries: number; correct: number }>();
  for (const a of attempts) {
    if (!a.readingSkillCode) continue;
    const row = by.get(a.readingSkillCode) ?? { firstTries: 0, correct: 0 };
    row.firstTries++;
    if (a.isCorrect) row.correct++;
    by.set(a.readingSkillCode, row);
  }
  return [...by.entries()]
    .map(([code, r]) => ({ code, ...r, percent: Math.round((r.correct / r.firstTries) * 100) }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function comprehensionByStory(attempts: readonly ComprehensionAttempt[]) {
  const by = new Map<string, { firstTries: number; correct: number }>();
  for (const a of attempts) {
    if (!a.storyId) continue;
    const row = by.get(a.storyId) ?? { firstTries: 0, correct: 0 };
    row.firstTries++;
    if (a.isCorrect) row.correct++;
    by.set(a.storyId, row);
  }
  return new Map(
    [...by.entries()].map(([id, r]) => [id, { ...r, percent: Math.round((r.correct / r.firstTries) * 100) }]),
  );
}

// ---- Recommendations ----------------------------------------------------------------------

export type LibraryText = {
  id: string;
  levelRank: number;
  readingLevel: number | null;
  difficulty: number;
  lessonId: string | null;
};

export type ReadingRecommendation = {
  storyId: string;
  reason: "next" | "reread" | "stretch";
};

// What to read next: texts with a lesson at the child's level not read yet (easiest first);
// texts whose questions went poorly come back as a re-read; when everything at the level is
// done, the first text of the next level is a stretch.
export function recommendReading(args: {
  texts: readonly LibraryText[];
  levelRank: number;
  readStoryIds: ReadonlySet<string>;
  comprehension: ReadonlyMap<string, { percent: number }>;
  limit?: number;
  rules?: ReadingRules;
}): ReadingRecommendation[] {
  const rules = args.rules ?? DEFAULT_RULES.reading;
  const order = (a: LibraryText, b: LibraryText) =>
    (a.readingLevel ?? a.difficulty * 2) - (b.readingLevel ?? b.difficulty * 2) ||
    a.difficulty - b.difficulty ||
    a.id.localeCompare(b.id);
  const playable = args.texts.filter((t) => t.lessonId);
  const atLevel = playable.filter((t) => t.levelRank === args.levelRank).sort(order);
  const out: ReadingRecommendation[] = [];
  for (const t of atLevel) {
    const score = args.comprehension.get(t.id);
    if (score && score.percent < rules.rereadBelowPercent) out.push({ storyId: t.id, reason: "reread" });
  }
  for (const t of atLevel) if (!args.readStoryIds.has(t.id)) out.push({ storyId: t.id, reason: "next" });
  if (!atLevel.some((t) => !args.readStoryIds.has(t.id))) {
    const next = playable
      .filter((t) => t.levelRank === args.levelRank + 1 && !args.readStoryIds.has(t.id))
      .sort(order)[0];
    if (next) out.push({ storyId: next.id, reason: "stretch" });
  }
  return out.slice(0, args.limit ?? 3);
}

// ---- Review: words tapped for help -------------------------------------------------------

export const readingKey = (wordId: string) => `reading:${wordId}`;

// One open review item per word the child keeps tapping for help while reading. Looks at the
// child's latest readings of texts that contain the word: tapped in at least
// `helpTapsForReview` of the last `helpLookbackSessions`, and not since read without help or
// answered right on the first try (attempts about the word).
export function deriveReadingWordReview(
  word: {
    wordId: string;
    lessonId: string | null;
    // Readings of texts that contain the word, any order.
    readings: readonly { startedAt: string; tapped: boolean }[];
    // Latest first-try right answer about the word (any question), if any.
    lastCorrectAt: string | null;
  },
  now: Date,
  rules: ReadingRules = DEFAULT_RULES.reading,
): ReviewItemRow | null {
  const latest = [...word.readings]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, rules.helpLookbackSessions);
  const taps = latest.filter((r) => r.tapped);
  if (taps.length < rules.helpTapsForReview) return null;
  // The newest reading was without help: the child can read it now.
  if (!latest[0].tapped) return null;
  const lastTap = taps[0].startedAt;
  if (word.lastCorrectAt && word.lastCorrectAt > lastTap) return null;
  return {
    item_key: readingKey(word.wordId),
    skill_id: null,
    word_id: word.wordId,
    phonics_pattern_id: null,
    lesson_id: word.lessonId,
    priority: Math.min(100, 40 + 10 * taps.length),
    due_at: now.toISOString(),
    reason: "reading_word",
    status: "open",
    resolved_at: null,
  };
}
