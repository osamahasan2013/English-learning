import { describe, expect, it } from "vitest";
import { isAchievementEarned } from "@/lib/learning/achievements";

describe("isAchievementEarned", () => {
  const stats = { lessonsCompleted: 1, starsEarned: 3, streakDays: 0, wordsLearned: 9 };
  it("evaluates data-defined criteria", () => {
    expect(isAchievementEarned({ type: "lessons_completed", threshold: 1 }, stats)).toBe(true);
    expect(isAchievementEarned({ type: "words_learned", threshold: 10 }, stats)).toBe(false);
  });
  it("never awards malformed criteria", () => {
    expect(isAchievementEarned({ type: "logins", threshold: 1 }, stats)).toBe(false);
    expect(isAchievementEarned(null, stats)).toBe(false);
  });
});
