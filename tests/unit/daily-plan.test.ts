import { describe, expect, it } from "vitest";
import type { AdaptiveRecommendation, RecommendationKind } from "@/lib/learning/adaptive";
import { buildDailyPlan } from "@/lib/learning/daily-plan";
import { DEFAULT_RULES } from "@/lib/learning/rules";

const rec = (key: string, kind: RecommendationKind, minutes = 5): AdaptiveRecommendation => ({
  key,
  kind,
  priority: kind === "repair" ? "high" : kind === "stretch" ? "low" : "medium",
  lessonId: key,
  title: key,
  emoji: "",
  domain: "PHONICS",
  skillId: null,
  minutes,
  recheck: null,
  reasons: [{ code: "target" }],
  childMessage: `do ${key}`,
  parentMessage: "",
});

describe("buildDailyPlan (learning zone)", () => {
  it("fills the day with target lessons when nothing else is recommended", () => {
    const plan = buildDailyPlan({
      dailyMinutes: 15,
      recommendations: [rec("l1", "target"), rec("l2", "target"), rec("l3", "target"), rec("l4", "target")],
    });
    expect(plan.map((p) => p.lessonId)).toEqual(["l1", "l2", "l3"]);
    expect(plan.reduce((s, p) => s + p.minutes, 0)).toBe(15);
  });

  it("shares the day by the learning zone: repair first, a new lesson, review, more lessons, stretch", () => {
    const plan = buildDailyPlan({
      dailyMinutes: 30,
      recommendations: [
        rec("fix", "repair"),
        rec("old", "review"),
        rec("new1", "target"),
        rec("new2", "target"),
        rec("hard", "stretch", 3),
      ],
    });
    expect(plan.map((p) => p.key)).toEqual(["fix", "new1", "old", "new2", "hard"]);
    expect(plan.find((p) => p.key === "fix")!.message).toBe("do fix");
  });

  it("never plans more minutes than the parent's setting, and no duplicates", () => {
    for (const dailyMinutes of [10, 15, 20, 30, 45]) {
      const recommendations = Array.from({ length: 12 }, (_, i) =>
        rec(`r${i}`, (["review", "repair", "target", "stretch"] as const)[i % 4], 7),
      );
      const plan = buildDailyPlan({ dailyMinutes, recommendations });
      expect(plan.reduce((s, p) => s + p.minutes, 0)).toBeLessThanOrEqual(dailyMinutes);
      expect(new Set(plan.map((p) => p.key)).size).toBe(plan.length);
      expect(plan.every((p) => p.minutes >= 3)).toBe(true);
    }
  });

  it("follows the configured zone shares", () => {
    const reviewHeavy = {
      ...DEFAULT_RULES.adaptive,
      zone: { review: 0.7, repair: 0.1, target: 0.2, stretch: 0 },
    };
    const recs = [rec("a", "review"), rec("b", "review"), rec("c", "review"), rec("t", "target", 10)];
    const plan = buildDailyPlan({ dailyMinutes: 15, recommendations: recs, rules: reviewHeavy });
    expect(plan.filter((p) => p.bucket === "review").length).toBeGreaterThanOrEqual(2);
  });

  it("returns an empty plan when there is nothing to do", () => {
    expect(buildDailyPlan({ dailyMinutes: 15, recommendations: [] })).toEqual([]);
  });
});
