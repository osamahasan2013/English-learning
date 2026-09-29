import type { Enums } from "@/lib/supabase/types";

// Transparent, rule-based skill mastery (V1). Every number here is documented in
// docs/curriculum.md → "Mastery model", so a parent-facing explanation can quote it.
// Mastery is always recomputed from the child's stored first-try attempts, never
// incremented, so it can be rebuilt at any time and a retried sync cannot inflate it.

export type MasteryStatus = Enums<"mastery_status">;

export const MASTERY_RULES = {
  // Accuracy is judged on the most recent attempts, weighted towards the latest ones.
  windowSize: 30,
  recentSize: 10,
  recentWeight: 0.6,
  // Repeated evidence required before a skill can be MASTERED: enough attempts, spread
  // over more than one day. One good session is never enough.
  masteredMinAttempts: 12,
  masteredMinPracticeDays: 2,
  almostScore: 80,
  almostMinAttempts: 8,
  practicingScore: 60,
  practicingMinAttempts: 4,
  confidenceAttempts: 20,
  // Days until a skill is due for review, by status.
  reviewIntervalDays: {
    NOT_STARTED: 0,
    LEARNING: 1,
    PRACTICING: 2,
    ALMOST_MASTERED: 4,
    MASTERED: 7,
  } satisfies Record<MasteryStatus, number>,
} as const;

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
  correct: number;
  practiceDays: number;
  confidence: number;
  reviewPriority: number;
  nextReviewAt: Date | null;
  lastPracticedAt: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeMastery(input: MasteryInput): MasteryResult {
  const sorted = [...input.attempts]
    .map((a) => ({ isCorrect: a.isCorrect, at: new Date(a.attemptedAt) }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const window = sorted.slice(0, MASTERY_RULES.windowSize);
  const recent = sorted.slice(0, MASTERY_RULES.recentSize);

  const attempts = Math.max(input.totalAttempts ?? 0, sorted.length);
  const correct = Math.max(input.totalCorrect ?? 0, sorted.filter((a) => a.isCorrect).length);

  if (attempts === 0) {
    return {
      status: "NOT_STARTED",
      masteryScore: 0,
      accuracy: 0,
      recentAccuracy: 0,
      attempts: 0,
      correct: 0,
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
  const masteryScore = round(
    100 * (MASTERY_RULES.recentWeight * recentAccuracy + (1 - MASTERY_RULES.recentWeight) * windowAccuracy),
  );
  const practiceDays = new Set(window.map((a) => a.at.toISOString().slice(0, 10))).size;
  const evidence = window.length;

  let status: MasteryStatus;
  if (
    masteryScore >= input.masteryThreshold &&
    evidence >= MASTERY_RULES.masteredMinAttempts &&
    practiceDays >= MASTERY_RULES.masteredMinPracticeDays
  ) {
    status = "MASTERED";
  } else if (masteryScore >= MASTERY_RULES.almostScore && evidence >= MASTERY_RULES.almostMinAttempts) {
    status = "ALMOST_MASTERED";
  } else if (
    masteryScore >= MASTERY_RULES.practicingScore &&
    evidence >= MASTERY_RULES.practicingMinAttempts
  ) {
    status = "PRACTICING";
  } else {
    status = "LEARNING";
  }

  const lastPracticedAt = sorted[0].at;
  const lastWasWrong = !sorted[0].isCorrect;
  const intervalDays = lastWasWrong ? 1 : MASTERY_RULES.reviewIntervalDays[status];
  const nextReviewAt = new Date(lastPracticedAt.getTime() + intervalDays * DAY_MS);

  return {
    status,
    masteryScore,
    accuracy: round((100 * correct) / attempts),
    recentAccuracy: round(100 * recentAccuracy),
    attempts,
    correct,
    practiceDays,
    confidence: Math.round(Math.min(1, attempts / MASTERY_RULES.confidenceAttempts) * 1000) / 1000,
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
