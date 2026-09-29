import { z } from "zod";

// Achievement criteria are data (achievements.criteria); this evaluates them against a
// child's derived stats. Unknown criteria types never award anything.

export const achievementCriteriaSchema = z.object({
  type: z.enum(["lessons_completed", "stars_earned", "streak_days", "words_learned"]),
  threshold: z.number().int().positive(),
});
export type AchievementCriteria = z.infer<typeof achievementCriteriaSchema>;

export type AchievementStats = {
  lessonsCompleted: number;
  starsEarned: number;
  streakDays: number;
  wordsLearned: number;
};

export function isAchievementEarned(criteria: unknown, stats: AchievementStats) {
  const parsed = achievementCriteriaSchema.safeParse(criteria);
  if (!parsed.success) return false;
  const { type, threshold } = parsed.data;
  const value = {
    lessons_completed: stats.lessonsCompleted,
    stars_earned: stats.starsEarned,
    streak_days: stats.streakDays,
    words_learned: stats.wordsLearned,
  }[type];
  return value >= threshold;
}
