import { DEFAULT_RULES, type MasteryRules } from "@/lib/learning/rules";
import type { Enums } from "@/lib/supabase/types";

// Transparent, rule-based skill mastery. Every number is a learning rule documented in
// docs/curriculum.md → "Mastery model", so a parent-facing explanation can quote it.
// Mastery is always recomputed from the child's stored first-try attempts, never
// incremented, so it can be rebuilt at any time and a retried sync cannot inflate it.

export type MasteryStatus = Enums<"mastery_status">;

// Status bands, evidence and review intervals come from the learning rules
// (src/lib/learning/rules.ts; overridable in the learning_rules table).
export const MASTERY_STATUSES: MasteryStatus[] = [
  "NOT_STARTED",
  "LEARNING",
  "PRACTICING",
  "ALMOST_MASTERED",
  "MASTERED",
];

export function masteryRank(status: MasteryStatus) {
  return MASTERY_STATUSES.indexOf(status);
}

// Score → status. `masteryThreshold` is the skill's own bar: a skill can ask for more
// than the global MASTERED band, never less.
export function statusForScore(args: {
  masteryScore: number;
  attempts: number;
  practiceDays: number;
  masteryThreshold: number;
  rules?: MasteryRules;
}): MasteryStatus {
  const rules = args.rules ?? DEFAULT_RULES.mastery;
  if (args.attempts === 0) return "NOT_STARTED";
  const masteredAt = Math.max(rules.bands.mastered, args.masteryThreshold);
  if (args.masteryScore >= masteredAt) {
    return args.practiceDays >= rules.masteredMinPracticeDays ? "MASTERED" : "ALMOST_MASTERED";
  }
  if (args.masteryScore >= rules.bands.almostMastered) return "ALMOST_MASTERED";
  if (args.masteryScore >= rules.bands.practicing) return "PRACTICING";
  return "LEARNING";
}

export type MasteryAttempt = {
  isCorrect: boolean;
  attemptedAt: string | Date;
};

export type MasteryInput = {
  // First-try attempts for one skill (any order; only the latest windowSize are used).
  attempts: MasteryAttempt[];
  // All-time totals, when the caller only loaded the latest window.
  totalAttempts?: number;
  totalCorrect?: number;
  masteryThreshold: number;
  importance: number;
  now: Date;
};

export type MasteryResult = {
  status: MasteryStatus;
  masteryScore: number;
  accuracy: number;
  recentAccuracy: number;
  attempts: number;
  correctAttempts: number;
  practiceDays: number;
  confidence: number;
  reviewPriority: number;
  nextReviewAt: Date | null;
  lastPracticedAt: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeMastery(
  input: MasteryInput,
  rules: MasteryRules = DEFAULT_RULES.mastery,
): MasteryResult {
  const sorted = [...input.attempts]
    .map((a) => ({ isCorrect: a.isCorrect, at: new Date(a.attemptedAt) }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const window = sorted.slice(0, rules.windowSize);
  const recent = sorted.slice(0, rules.recentSize);

  const attempts = Math.max(input.totalAttempts ?? 0, sorted.length);
  const correctAttempts = Math.max(input.totalCorrect ?? 0, sorted.filter((a) => a.isCorrect).length);

  if (attempts === 0) {
    return {
      status: "NOT_STARTED",
      masteryScore: 0,
      accuracy: 0,
      recentAccuracy: 0,
      attempts: 0,
      correctAttempts: 0,
      practiceDays: 0,
      confidence: 0,
      reviewPriority: 0,
      nextReviewAt: null,
      lastPracticedAt: null,
    };
  }

  const ratio = (list: typeof sorted) =>
    list.length ? list.filter((a) => a.isCorrect).length / list.length : 0;
  const windowAccuracy = ratio(window);
  const recentAccuracy = ratio(recent);
  const evidence = Math.min(1, window.length / rules.fullEvidenceAttempts);
  const masteryScore = round(
    100 * evidence * (rules.recentWeight * recentAccuracy + (1 - rules.recentWeight) * windowAccuracy),
  );
  const practiceDays = new Set(window.map((a) => a.at.toISOString().slice(0, 10))).size;
  const status = statusForScore({
    masteryScore,
    attempts,
    practiceDays,
    masteryThreshold: input.masteryThreshold,
    rules,
  });

  const lastPracticedAt = sorted[0].at;
  const lastWasWrong = !sorted[0].isCorrect;
  const intervalDays = lastWasWrong ? rules.afterMistakeReviewDays : rules.reviewIntervalDays[status];
  const nextReviewAt = new Date(lastPracticedAt.getTime() + intervalDays * DAY_MS);

  return {
    status,
    masteryScore,
    accuracy: round((100 * correctAttempts) / attempts),
    recentAccuracy: round(100 * recentAccuracy),
    attempts,
    correctAttempts,
    practiceDays,
    confidence: Math.round(Math.min(1, attempts / rules.confidenceAttempts) * 1000) / 1000,
    reviewPriority: computeReviewPriority({
      masteryScore,
      recentErrors: sorted.slice(0, 5).filter((a) => !a.isCorrect).length,
      daysOverdue: (input.now.getTime() - nextReviewAt.getTime()) / DAY_MS,
      importance: input.importance,
    }),
    nextReviewAt,
    lastPracticedAt,
  };
}

// 0..100, higher = review sooner. Weakness dominates; recent mistakes, being overdue and
// the skill's importance (1..5) raise it further.
export function computeReviewPriority(args: {
  masteryScore: number;
  recentErrors: number;
  daysOverdue: number;
  importance: number;
}) {
  const weakness = 100 - args.masteryScore;
  const mistakes = 8 * args.recentErrors;
  const overdue = Math.min(20, Math.max(0, args.daysOverdue) * 4);
  const importanceFactor = 0.8 + 0.1 * Math.min(5, Math.max(1, args.importance));
  return round(Math.min(100, Math.max(0, (weakness * 0.6 + mistakes + overdue) * importanceFactor)));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
