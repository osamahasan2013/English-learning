import { describe, expect, it } from "vitest";
import { scoreLesson } from "@/lib/learning/scoring";

const tries = (pattern: string) => [...pattern].map((c) => ({ isCorrect: c === "1" }));

describe("scoreLesson", () => {
  it("scores an empty lesson as zero", () => {
    expect(scoreLesson([])).toEqual({ total: 0, correct: 0, percent: 0, stars: 0, points: 0 });
  });

  it.each([
    ["1111111111", 100, 3],
    ["1111111110", 90, 3],
    ["1111111000", 70, 2],
    ["1111110000", 60, 1],
    ["0000000000", 0, 1],
  ])("%s → %d%% and %d stars", (pattern, percent, stars) => {
    const score = scoreLesson(tries(pattern));
    expect(score.percent).toBe(percent);
    expect(score.stars).toBe(stars);
  });

  it("awards points for correct answers and stars", () => {
    expect(scoreLesson(tries("110")).points).toBe(2 * 10 + 1 * 5);
  });

  it("rounds percentages to two decimals", () => {
    expect(scoreLesson(tries("110")).percent).toBe(66.67);
  });
});
