import { DEFAULT_RULES, type ScoringRules } from "@/lib/learning/rules";

// Scoring utilities. Pure and shared by the lesson summary screen and the server (which
// recomputes everything from stored attempts; the device's numbers are never stored).
//
// Only first tries count toward lesson scores and mastery: a retry after feedback is
// practice, not evidence of what the child already knew. Each answer still gets its own
// score (right first time / right after feedback / wrong) for activity-level detail.

export type LessonScore = {
  total: number;
  correct: number;
  percent: number;
  stars: 0 | 1 | 2 | 3;
  points: number;
};

// 0–100 with two decimals; 0 when there is nothing to divide by.
export function percentage(part: number, whole: number) {
  if (whole <= 0) return 0;
  return Math.round((10000 * Math.min(part, whole)) / whole) / 100;
}

// Share of answers that were right, over every answer given (retries included).
export function accuracy(correctAttempts: number, attempts: number) {
  return percentage(correctAttempts, attempts);
}

export function attemptScore(
  isCorrect: boolean,
  attemptNumber: number,
  rules: ScoringRules = DEFAULT_RULES.scoring,
) {
  if (!isCorrect) return 0;
  return attemptNumber <= 1 ? rules.firstTryScore : rules.retryScore;
}

export function starsFor(percent: number, rules: ScoringRules = DEFAULT_RULES.scoring): 1 | 2 | 3 {
  // Finishing a lesson always earns at least one star.
  return percent >= rules.threeStarPercent ? 3 : percent >= rules.twoStarPercent ? 2 : 1;
}

export function scoreLesson(
  firstTries: { isCorrect: boolean }[],
  rules: ScoringRules = DEFAULT_RULES.scoring,
): LessonScore {
  const total = firstTries.length;
  const correct = firstTries.filter((t) => t.isCorrect).length;
  if (total === 0) return { total: 0, correct: 0, percent: 0, stars: 0, points: 0 };
  const percent = percentage(correct, total);
  const stars = starsFor(percent, rules);
  return {
    total,
    correct,
    percent,
    stars,
    points: correct * rules.pointsPerCorrect + stars * rules.pointsPerStar,
  };
}

export type ScoredAttempt = {
  questionId: string;
  attemptNumber: number;
  isCorrect: boolean;
  responseTimeMs: number;
};

export type AttemptSummary = {
  // Every answer, retries included.
  attempts: number;
  correctAttempts: number;
  accuracy: number;
  // Questions answered (first tries) and how many of those were right: the raw score.
  questionsAnswered: number;
  rawScore: number;
  // rawScore as a percentage of `questionsTotal` (or of the questions answered).
  percent: number;
  totalTimeMs: number;
  averageTimeMs: number;
};

// Summarises a set of answers (one run, one activity, one session...). Duplicate first
// tries for the same question keep the earliest-listed one.
export function summarizeAttempts(attempts: ScoredAttempt[], questionsTotal?: number): AttemptSummary {
  const firstTries = new Map<string, boolean>();
  for (const a of attempts) {
    if (a.attemptNumber === 1 && !firstTries.has(a.questionId)) firstTries.set(a.questionId, a.isCorrect);
  }
  const correctAttempts = attempts.filter((a) => a.isCorrect).length;
  const rawScore = [...firstTries.values()].filter(Boolean).length;
  const totalTimeMs = attempts.reduce((sum, a) => sum + Math.max(0, a.responseTimeMs), 0);
  return {
    attempts: attempts.length,
    correctAttempts,
    accuracy: accuracy(correctAttempts, attempts.length),
    questionsAnswered: firstTries.size,
    rawScore,
    percent: percentage(rawScore, questionsTotal ?? firstTries.size),
    totalTimeMs,
    averageTimeMs: attempts.length ? Math.round(totalTimeMs / attempts.length) : 0,
  };
}
