import { computeMastery, type MasteryStatus } from "@/lib/learning/mastery";
import { WORD_LEARNED_CORRECT_COUNT } from "@/lib/learning/progress-derivation";
import { wordKey, type ReviewItemRow } from "@/lib/learning/review-queue";
import { DEFAULT_RULES, type LearningRules } from "@/lib/learning/rules";

// Word-level progress: mastery of one word, per-area performance, review and the parent
// summary. Pure functions over stored first tries (no I/O), recomputed from history like
// every other progress figure. Word mastery is skill mastery's algorithm (mastery.ts) with
// the vocabulary rule set's evidence target — not a separate model.

// What a question about a word exercises: SEE → HEAR → RECOGNIZE → UNDERSTAND → READ →
// SPELL → USE.
export const WORD_AREAS = ["recognition", "listening", "meaning", "reading", "spelling", "usage"] as const;
export type WordArea = (typeof WORD_AREAS)[number];

export const WORD_AREA_LABELS: Record<WordArea, { label: string; emoji: string }> = {
  recognition: { label: "Recognising", emoji: "👀" },
  listening: { label: "Listening", emoji: "👂" },
  meaning: { label: "Meaning", emoji: "💡" },
  reading: { label: "Reading", emoji: "📖" },
  spelling: { label: "Spelling", emoji: "✏️" },
  usage: { label: "Using words", emoji: "💬" },
};

// When a question does not say (metadata.wordArea, set by the vocabulary templates), its
// type decides. Types that are not about a word's knowledge (tracing, intros) have none.
const AREA_BY_TYPE: Record<string, WordArea> = {
  LISTEN_AND_CHOOSE: "listening",
  SEGMENT_WORD: "listening",
  PICTURE_MATCH: "recognition",
  MULTIPLE_CHOICE: "recognition",
  MATCH: "recognition",
  SORT: "meaning",
  READING: "reading",
  BLEND_SOUNDS: "reading",
  FIND_PATTERN: "reading",
  MISSING_LETTER: "spelling",
  WORD_BUILDER: "spelling",
  SPELLING: "spelling",
  WRITING: "spelling",
  DRAG_DROP: "usage",
  SENTENCE_BUILDER: "usage",
};

export function isWordArea(value: unknown): value is WordArea {
  return typeof value === "string" && (WORD_AREAS as readonly string[]).includes(value);
}

export function wordAreaFor(questionType: string, metadata: unknown): WordArea | null {
  const tagged =
    metadata && typeof metadata === "object" ? (metadata as { wordArea?: unknown }).wordArea : undefined;
  if (isWordArea(tagged)) return tagged;
  return AREA_BY_TYPE[questionType] ?? null;
}

export type WordAttempt = {
  id?: string;
  isCorrect: boolean;
  attemptedAt: string;
  area: WordArea | null;
};

export type WordAreaStats = {
  area: WordArea;
  attempts: number;
  correct: number;
  accuracy: number;
  lastPracticedAt: string;
};

export type WordProgressResult = {
  attempts: number;
  correct: number;
  accuracy: number;
  lastPracticedAt: string | null;
  status: MasteryStatus;
  masteryScore: number;
  practiceDays: number;
  reviewPriority: number;
  nextReviewAt: string | null;
  areas: WordAreaStats[];
};

const pct = (correct: number, total: number) => (total ? Math.round((10000 * correct) / total) / 100 : 0);

// One word's progress from its first tries (any order). A single right answer is LEARNING
// (evidence 1/6), never MASTERED; MASTERED also needs practice on two different days.
export function computeWordProgress(
  attempts: WordAttempt[],
  options: { now: Date; timeZone?: string; rules?: LearningRules },
): WordProgressResult {
  const rules = options.rules ?? DEFAULT_RULES;
  const mastery = computeMastery(
    {
      attempts: attempts.map((a) => ({ id: a.id, isCorrect: a.isCorrect, attemptedAt: a.attemptedAt })),
      masteryThreshold: 0,
      importance: 3,
      now: options.now,
      timeZone: options.timeZone,
    },
    { ...rules.mastery, fullEvidenceAttempts: rules.vocabulary.fullEvidenceAttempts },
  );
  const byArea = new Map<WordArea, WordAreaStats>();
  for (const a of attempts) {
    if (!a.area) continue;
    const s = byArea.get(a.area) ?? {
      area: a.area,
      attempts: 0,
      correct: 0,
      accuracy: 0,
      lastPracticedAt: a.attemptedAt,
    };
    s.attempts += 1;
    if (a.isCorrect) s.correct += 1;
    if (a.attemptedAt > s.lastPracticedAt) s.lastPracticedAt = a.attemptedAt;
    byArea.set(a.area, s);
  }
  const areas = WORD_AREAS.flatMap((area) => {
    const s = byArea.get(area);
    return s ? [{ ...s, accuracy: pct(s.correct, s.attempts) }] : [];
  });
  return {
    attempts: mastery.attempts,
    correct: mastery.correctAttempts,
    accuracy: mastery.accuracy,
    lastPracticedAt: mastery.lastPracticedAt?.toISOString() ?? null,
    status: mastery.status,
    masteryScore: mastery.masteryScore,
    practiceDays: mastery.practiceDays,
    reviewPriority: mastery.reviewPriority,
    nextReviewAt: mastery.nextReviewAt?.toISOString() ?? null,
    areas,
  };
}

// My Words: a word is saved automatically the first time it is answered right — unless
// the family already decided (saved or removed it themselves).
export function autoSaveDecision(
  current: { savedSource: "auto" | "manual" | null; isSaved: boolean } | null,
  correct: number,
) {
  if (current?.savedSource === "manual") return { isSaved: current.isSaved, savedSource: "manual" as const };
  if (current?.isSaved) return { isSaved: true, savedSource: current.savedSource ?? ("auto" as const) };
  return correct > 0
    ? { isSaved: true, savedSource: "auto" as const }
    : { isSaved: false, savedSource: current?.savedSource ?? null };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The review queue item for one word (one open item per word, key word:<id>), in order:
//   * missed_word — the latest first try (within the lookback) was wrong: due now;
//   * weak_word   — enough answers and accuracy below the bar (e.g. 42%): due now;
//   * due_review  — a saved word, practised before, at its next review date.
// Otherwise there is nothing to review and any open item is resolved.
export function deriveWordReview(
  word: {
    wordId: string;
    skillId: string | null;
    lessonId: string | null;
    saved: boolean;
    attempts: { isCorrect: boolean; attemptedAt: string }[];
    progress: Pick<WordProgressResult, "attempts" | "accuracy" | "reviewPriority" | "nextReviewAt">;
  },
  now: Date,
  rules: LearningRules = DEFAULT_RULES,
): ReviewItemRow | null {
  if (word.attempts.length === 0) return null;
  const latestFirst = [...word.attempts].sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt));
  const since = now.getTime() - rules.review.missedWordLookbackDays * DAY_MS;
  const recent = latestFirst.filter((a) => Date.parse(a.attemptedAt) >= since);
  const missed = recent.length > 0 && !recent[0].isCorrect;
  const weak =
    word.progress.attempts >= rules.vocabulary.minAttempts &&
    word.progress.accuracy < rules.vocabulary.weakBelowAccuracy;
  const scheduled = rules.vocabulary.reviewSavedWords && word.saved && word.progress.nextReviewAt !== null;
  if (!missed && !weak && !scheduled) return null;

  const misses = recent.filter((a) => !a.isCorrect).length;
  const reason = missed ? "missed_word" : weak ? "weak_word" : "due_review";
  const priority =
    reason === "missed_word"
      ? Math.min(100, 40 + 15 * misses)
      : reason === "weak_word"
        ? Math.min(100, Math.max(50, word.progress.reviewPriority))
        : word.progress.reviewPriority;
  return {
    item_key: wordKey(word.wordId),
    skill_id: word.skillId,
    word_id: word.wordId,
    phonics_pattern_id: null,
    lesson_id: word.lessonId,
    priority: Math.round(priority * 100) / 100,
    due_at: reason === "due_review" ? word.progress.nextReviewAt! : now.toISOString(),
    reason,
    status: "open",
    resolved_at: null,
  };
}

// ---------------------------------------------------------------------------------------
// Parent summary

export type VocabularyWordFact = {
  wordId: string;
  word: string;
  emoji: string;
  categoryCode: string | null;
  categoryName: string | null;
  status: MasteryStatus;
  attempts: number;
  correct: number;
  accuracy: number;
  isSaved: boolean;
  lastPracticedAt: string | null;
};

export type VocabularyAreaFact = { area: WordArea; attempts: number; correct: number };

export type VocabularySummary = {
  wordsSeen: number;
  wordsPracticed: number;
  // Answered right on the first try at least twice (also the "words learned" badge).
  wordsLearned: number;
  wordsMastered: number;
  savedWords: number;
  byStatus: Record<MasteryStatus, number>;
  areas: { area: WordArea; attempts: number; accuracy: number; weak: boolean }[];
  categories: {
    code: string;
    name: string;
    practiced: number;
    mastered: number;
    accuracy: number;
    weak: boolean;
  }[];
  weakWords: VocabularyWordFact[];
  recent: VocabularyWordFact[];
};

// What a parent needs, without noise: counts, the weakest areas and categories (only
// with enough answers to mean something) and the latest words.
export function summarizeVocabulary(
  words: VocabularyWordFact[],
  areaFacts: VocabularyAreaFact[],
  rules: LearningRules = DEFAULT_RULES,
): VocabularySummary {
  const practiced = words.filter((w) => w.attempts > 0);
  const byStatus = {
    NOT_STARTED: 0,
    LEARNING: 0,
    PRACTICING: 0,
    ALMOST_MASTERED: 0,
    MASTERED: 0,
  } satisfies Record<MasteryStatus, number>;
  for (const w of words) byStatus[w.status] += 1;

  const areaTotals = new Map<WordArea, { attempts: number; correct: number }>();
  for (const a of areaFacts) {
    const t = areaTotals.get(a.area) ?? { attempts: 0, correct: 0 };
    t.attempts += a.attempts;
    t.correct += a.correct;
    areaTotals.set(a.area, t);
  }
  const minEvidence = rules.vocabulary.minAttempts * 2;
  const weakBar = rules.vocabulary.weakBelowAccuracy;
  const areas = WORD_AREAS.flatMap((area) => {
    const t = areaTotals.get(area);
    if (!t || t.attempts === 0) return [];
    const accuracy = pct(t.correct, t.attempts);
    return [{ area, attempts: t.attempts, accuracy, weak: t.attempts >= minEvidence && accuracy < weakBar }];
  });

  const byCategory = new Map<string, { name: string; words: VocabularyWordFact[] }>();
  for (const w of practiced) {
    if (!w.categoryCode) continue;
    const entry = byCategory.get(w.categoryCode) ?? { name: w.categoryName ?? w.categoryCode, words: [] };
    entry.words.push(w);
    byCategory.set(w.categoryCode, entry);
  }
  const categories = [...byCategory]
    .map(([code, { name, words: list }]) => {
      const attempts = list.reduce((n, w) => n + w.attempts, 0);
      const correct = list.reduce((n, w) => n + w.correct, 0);
      const accuracy = pct(correct, attempts);
      return {
        code,
        name,
        practiced: list.length,
        mastered: list.filter((w) => w.status === "MASTERED").length,
        accuracy,
        weak: attempts >= minEvidence && accuracy < weakBar,
      };
    })
    .sort((a, b) => b.practiced - a.practiced || a.name.localeCompare(b.name));

  const weakWords = practiced
    .filter((w) => w.attempts >= rules.vocabulary.minAttempts && w.accuracy < weakBar)
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
    .slice(0, 8);
  const recent = practiced
    .filter((w) => w.lastPracticedAt)
    .sort((a, b) => (b.lastPracticedAt ?? "").localeCompare(a.lastPracticedAt ?? ""))
    .slice(0, 8);

  return {
    wordsSeen: words.length,
    wordsPracticed: practiced.length,
    wordsLearned: words.filter((w) => w.correct >= WORD_LEARNED_CORRECT_COUNT).length,
    wordsMastered: byStatus.MASTERED,
    savedWords: words.filter((w) => w.isSaved).length,
    byStatus,
    areas,
    categories,
    weakWords,
    recent,
  };
}

// Stars for children: 0 not started · 1 learning · 2 practising/almost · 3 mastered.
export function wordStars(status: MasteryStatus) {
  switch (status) {
    case "NOT_STARTED":
      return 0;
    case "LEARNING":
      return 1;
    case "PRACTICING":
    case "ALMOST_MASTERED":
      return 2;
    case "MASTERED":
      return 3;
  }
}

// Picks practice questions: words in the given order (most urgent first), at most
// `perWord` each, varied by area so a session is not five spelling questions in a row.
export function pickPracticeQuestions<Q extends { id: string; wordId: string | null; area: WordArea | null }>(
  questions: Q[],
  wordOrder: string[],
  limit: number,
  perWord = 2,
): Q[] {
  const byWord = new Map<string, Q[]>();
  for (const q of questions) {
    if (!q.wordId) continue;
    const list = byWord.get(q.wordId) ?? [];
    list.push(q);
    byWord.set(q.wordId, list);
  }
  const picked: Q[] = [];
  const usedAreas = new Map<string, Set<string>>();
  for (let round = 0; round < perWord && picked.length < limit; round++) {
    for (const wordId of wordOrder) {
      if (picked.length >= limit) break;
      const list = byWord.get(wordId);
      if (!list?.length) continue;
      const used = usedAreas.get(wordId) ?? new Set<string>();
      const index = Math.max(
        0,
        list.findIndex((q) => !used.has(q.area ?? "")),
      );
      const [q] = list.splice(index, 1);
      used.add(q.area ?? "");
      usedAreas.set(wordId, used);
      picked.push(q);
    }
  }
  return picked;
}
