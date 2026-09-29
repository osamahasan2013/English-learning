import { describe, expect, it } from "vitest";
import {
  computeMastery,
  computeReviewPriority,
  MASTERY_RULES,
  type MasteryAttempt,
} from "@/lib/learning/mastery";

const now = new Date("2026-09-29T12:00:00Z");

function attempts(pattern: string, day = "2026-09-29") {
  // "1" = correct, "0" = wrong; the first character is the oldest attempt.
  return [...pattern].map<MasteryAttempt>((c, i) => ({
    isCorrect: c === "1",
    attemptedAt: `${day}T08:${String(i).padStart(2, "0")}:00Z`,
  }));
}

const base = { masteryThreshold: 90, importance: 3, now };

describe("computeMastery", () => {
  it("is NOT_STARTED with no attempts", () => {
    const result = computeMastery({ ...base, attempts: [] });
    expect(result.status).toBe("NOT_STARTED");
    expect(result.reviewPriority).toBe(0);
    expect(result.nextReviewAt).toBeNull();
  });

  it("never marks one successful attempt as mastered", () => {
    const result = computeMastery({ ...base, attempts: attempts("1") });
    expect(result.masteryScore).toBe(100);
    expect(result.status).toBe("LEARNING");
  });

  it("requires practice on more than one day before MASTERED", () => {
    const oneDay = computeMastery({ ...base, attempts: attempts("111111111111") });
    expect(oneDay.status).toBe("ALMOST_MASTERED");

    const twoDays = computeMastery({
      ...base,
      attempts: [...attempts("111111", "2026-09-28"), ...attempts("111111", "2026-09-29")],
    });
    expect(twoDays.practiceDays).toBe(2);
    expect(twoDays.status).toBe("MASTERED");
  });

  it("weights recent attempts, so a skill that slips loses mastery", () => {
    const improving = computeMastery({ ...base, attempts: attempts("00000011111111111111") });
    const slipping = computeMastery({ ...base, attempts: attempts("11111111110000011111") });
    expect(improving.recentAccuracy).toBe(100);
    expect(slipping.recentAccuracy).toBe(50);
    expect(improving.masteryScore).toBeGreaterThan(slipping.masteryScore);
  });

  it("moves through PRACTICING at moderate accuracy", () => {
    const result = computeMastery({ ...base, attempts: attempts("10110110") });
    expect(result.status).toBe("PRACTICING");
  });

  it("uses all-time totals for accuracy when only a window was loaded", () => {
    const result = computeMastery({
      ...base,
      attempts: attempts("1111"),
      totalAttempts: 40,
      totalCorrect: 30,
    });
    expect(result.attempts).toBe(40);
    expect(result.accuracy).toBe(75);
  });

  it("schedules review sooner after a mistake", () => {
    const afterMistake = computeMastery({ ...base, attempts: attempts("11110") });
    const lastAt = new Date("2026-09-29T08:04:00Z").getTime();
    expect(afterMistake.nextReviewAt?.getTime()).toBe(lastAt + 24 * 60 * 60 * 1000);
  });

  it("only uses the most recent window of attempts for accuracy", () => {
    const old = attempts("0".repeat(50), "2026-09-01");
    const recent = [...attempts("1".repeat(15), "2026-09-28"), ...attempts("1".repeat(15), "2026-09-29")];
    const result = computeMastery({ ...base, attempts: [...old, ...recent] });
    expect(result.masteryScore).toBe(100);
    expect(result.accuracy).toBeCloseTo((100 * 30) / 80, 1);
    expect(MASTERY_RULES.windowSize).toBe(30);
  });
});

describe("computeReviewPriority", () => {
  it("ranks weak skills above strong ones", () => {
    const weak = computeReviewPriority({ masteryScore: 40, recentErrors: 2, daysOverdue: 0, importance: 3 });
    const strong = computeReviewPriority({
      masteryScore: 95,
      recentErrors: 0,
      daysOverdue: 0,
      importance: 3,
    });
    expect(weak).toBeGreaterThan(strong);
  });

  it("raises priority when overdue and for important skills, capped at 100", () => {
    const due = computeReviewPriority({ masteryScore: 90, recentErrors: 0, daysOverdue: 3, importance: 3 });
    const notDue = computeReviewPriority({
      masteryScore: 90,
      recentErrors: 0,
      daysOverdue: -2,
      importance: 3,
    });
    expect(due).toBeGreaterThan(notDue);
    expect(
      computeReviewPriority({ masteryScore: 90, recentErrors: 0, daysOverdue: 0, importance: 5 }),
    ).toBeGreaterThan(
      computeReviewPriority({ masteryScore: 90, recentErrors: 0, daysOverdue: 0, importance: 1 }),
    );
    expect(computeReviewPriority({ masteryScore: 0, recentErrors: 5, daysOverdue: 30, importance: 5 })).toBe(
      100,
    );
  });
});
