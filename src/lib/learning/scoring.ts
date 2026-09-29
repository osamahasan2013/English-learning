// Lesson scoring. Only first tries count: a retry after feedback is practice, not
// evidence of what the child already knew. Used by the lesson summary screen and, with
// the same inputs, by the server when it records the lesson run.

export const SCORING_RULES = {
  threeStarPercent: 90,
  twoStarPercent: 70,
  pointsPerCorrect: 10,
  pointsPerStar: 5,
} as const;

export type LessonScore = {
  total: number;
  correct: number;
  percent: number;
  stars: 0 | 1 | 2 | 3;
  points: number;
};

export function scoreLesson(firstTries: { isCorrect: boolean }[]): LessonScore {
  const total = firstTries.length;
  const correct = firstTries.filter((t) => t.isCorrect).length;
  if (total === 0) return { total: 0, correct: 0, percent: 0, stars: 0, points: 0 };
  const percent = Math.round((10000 * correct) / total) / 100;
  // Finishing a lesson always earns at least one star.
  const stars =
    percent >= SCORING_RULES.threeStarPercent ? 3 : percent >= SCORING_RULES.twoStarPercent ? 2 : 1;
  return {
    total,
    correct,
    percent,
    stars,
    points: correct * SCORING_RULES.pointsPerCorrect + stars * SCORING_RULES.pointsPerStar,
  };
}
