import { describe, expect, it } from "vitest";
import { computePlacement, type PlacementConfig } from "@/lib/learning/placement";
import { isAchievementEarned } from "@/lib/learning/achievements";

const config: PlacementConfig = {
  startLevelCode: "KG1",
  stages: [
    { stage: 1, label: "Letters", passPercent: 80, levelOnPass: "KG2" },
    { stage: 2, label: "Sounds", passPercent: 80, levelOnPass: "KG3" },
    { stage: 3, label: "Digraphs", passPercent: 75, levelOnPass: "GRADE1" },
    { stage: 4, label: "Reading", passPercent: 75, levelOnPass: "GRADE2" },
  ],
};

describe("computePlacement", () => {
  it("suggests the level of the last stage passed and reports the first gap", () => {
    const outcome = computePlacement(config, [
      { stage: 1, correct: 5, total: 5 },
      { stage: 2, correct: 4, total: 5 },
      { stage: 3, correct: 2, total: 5 },
    ]);
    expect(outcome).toEqual({
      suggestedLevelCode: "KG3",
      stagesPassed: [1, 2],
      firstGapStage: 3,
      overallPercent: 73.33,
    });
  });

  it("starts at the base level when the first stage is not passed", () => {
    expect(computePlacement(config, [{ stage: 1, correct: 1, total: 5 }]).suggestedLevelCode).toBe("KG1");
  });

  it("stops at an unanswered stage even if later stages were passed", () => {
    const outcome = computePlacement(config, [
      { stage: 1, correct: 5, total: 5 },
      { stage: 3, correct: 5, total: 5 },
    ]);
    expect(outcome.suggestedLevelCode).toBe("KG2");
    expect(outcome.firstGapStage).toBe(2);
  });

  it("suggests the top level when everything is passed", () => {
    const all = config.stages.map((s) => ({ stage: s.stage, correct: 4, total: 4 }));
    expect(computePlacement(config, all)).toMatchObject({
      suggestedLevelCode: "GRADE2",
      firstGapStage: null,
    });
  });
});

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
