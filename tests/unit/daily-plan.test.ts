import { describe, expect, it } from "vitest";
import { buildDailyPlan } from "@/lib/learning/daily-plan";

const lesson = (n: number, minutes = 5) => ({
  lessonId: `l${n}`,
  title: `Lesson ${n}`,
  subjectName: "Phonics",
  estimatedMinutes: minutes,
});
const review = (id: string) => ({ skillId: id, title: id, lessonId: `review-${id}`, subjectName: "Phonics" });

describe("buildDailyPlan", () => {
  it("fills the day with new lessons when nothing needs review", () => {
    const plan = buildDailyPlan({
      dailyMinutes: 15,
      nextLessons: [lesson(1), lesson(2), lesson(3), lesson(4)],
      reviews: [],
    });
    expect(plan.map((p) => p.lessonId)).toEqual(["l1", "l2", "l3"]);
    expect(plan.reduce((s, p) => s + p.minutes, 0)).toBe(15);
  });

  it("reserves review time for weak skills, after the first new lesson", () => {
    const plan = buildDailyPlan({
      dailyMinutes: 20,
      nextLessons: [lesson(1), lesson(2), lesson(3)],
      reviews: [review("th")],
    });
    expect(plan.map((p) => p.kind)).toEqual(["lesson", "review", "lesson", "lesson"]);
    expect(plan[1]).toMatchObject({ kind: "review", skillId: "th", minutes: 6 });
    expect(plan.reduce((s, p) => s + p.minutes, 0)).toBeLessThanOrEqual(20);
  });

  it("never plans more minutes than the parent's setting", () => {
    for (const dailyMinutes of [10, 15, 20, 30, 45]) {
      const plan = buildDailyPlan({
        dailyMinutes,
        nextLessons: Array.from({ length: 20 }, (_, i) => lesson(i, 7)),
        reviews: [review("a"), review("b"), review("c")],
      });
      expect(plan.reduce((s, p) => s + p.minutes, 0)).toBeLessThanOrEqual(dailyMinutes);
      expect(plan.filter((p) => p.kind === "review").length).toBeLessThanOrEqual(2);
    }
  });

  it("returns an empty plan when there is nothing to do", () => {
    expect(buildDailyPlan({ dailyMinutes: 15, nextLessons: [], reviews: [] })).toEqual([]);
  });
});
