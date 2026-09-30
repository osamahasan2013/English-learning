import { describe, expect, it } from "vitest";
import {
  computeMastery,
  computeReviewPriority,
  statusForScore,
  type MasteryAttempt,
} from "@/lib/learning/mastery";
import { DEFAULT_RULES, mergeLearningRules } from "@/lib/learning/rules";

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
    // One answer is a tenth of the evidence needed: 100% accuracy × 0.1 = 10.
    const result = computeMastery({ ...base, attempts: attempts("1") });
    expect(result.masteryScore).toBe(10);
    expect(result.status).toBe("LEARNING");
    // Repeated right answers build it up.
    expect(computeMastery({ ...base, attempts: attempts("11111") }).status).toBe("PRACTICING");
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
    expect(DEFAULT_RULES.mastery.windowSize).toBe(30);
  });
});

describe("mastery status bands", () => {
  const status = (masteryScore: number, extra: Partial<Parameters<typeof statusForScore>[0]> = {}) =>
    statusForScore({ masteryScore, attempts: 20, practiceDays: 3, masteryThreshold: 90, ...extra });

  it("maps scores to the default bands 0 / 1–39 / 40–69 / 70–89 / 90+", () => {
    expect(status(0, { attempts: 0 })).toBe("NOT_STARTED");
    expect(status(0)).toBe("LEARNING"); // started, but nothing right yet
    expect(status(1)).toBe("LEARNING");
    expect(status(39)).toBe("LEARNING");
    expect(status(40)).toBe("PRACTICING");
    expect(status(69.99)).toBe("PRACTICING");
    expect(status(70)).toBe("ALMOST_MASTERED");
    expect(status(89)).toBe("ALMOST_MASTERED");
    expect(status(90)).toBe("MASTERED");
    expect(status(100)).toBe("MASTERED");
  });

  it("needs practice on more than one day and respects a stricter skill threshold", () => {
    expect(status(95, { practiceDays: 1 })).toBe("ALMOST_MASTERED");
    expect(status(92, { masteryThreshold: 95 })).toBe("ALMOST_MASTERED");
    expect(status(96, { masteryThreshold: 95 })).toBe("MASTERED");
  });

  it("uses configured bands from the learning rules", () => {
    const { rules, errors } = mergeLearningRules([
      { code: "mastery", config: { bands: { practicing: 30, almostMastered: 60, mastered: 80 } } },
    ]);
    expect(errors).toEqual([]);
    expect(status(35, { rules: rules.mastery })).toBe("PRACTICING");
    expect(status(85, { rules: rules.mastery, masteryThreshold: 50 })).toBe("MASTERED");
  });

  it("is 100% only with enough evidence and 0% when every answer is wrong", () => {
    const perfect = computeMastery({
      ...base,
      attempts: [...attempts("11111", "2026-09-28"), ...attempts("11111", "2026-09-29")],
    });
    expect(perfect).toMatchObject({
      masteryScore: 100,
      accuracy: 100,
      status: "MASTERED",
      correctAttempts: 10,
    });
    const zero = computeMastery({ ...base, attempts: attempts("0000000000") });
    expect(zero).toMatchObject({ masteryScore: 0, accuracy: 0, status: "LEARNING", attempts: 10 });
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

describe("computeMastery determinism and calendar", () => {
  it("gives the same result whatever order same-time answers arrive in", () => {
    const earlier = attempts("111111111", "2026-09-24");
    const t = "2026-09-29T08:00:00Z";
    const right: MasteryAttempt = { id: "b", isCorrect: true, attemptedAt: t };
    const wrong: MasteryAttempt = { id: "a", isCorrect: false, attemptedAt: t };
    const one = computeMastery({ ...base, attempts: [...earlier, right, wrong] });
    const two = computeMastery({ ...base, attempts: [...earlier, wrong, right] });
    expect(one).toEqual(two);
  });

  it("counts practice days on the family's calendar, not UTC", () => {
    // 20:00 and 23:30 UTC on 28 Sep are both 29 Sep in Tokyo (UTC+9): one practice day
    // there, so ten perfect answers stay ALMOST_MASTERED; in UTC they span two days.
    const evening = [...Array(10)].map<MasteryAttempt>((_, i) => ({
      isCorrect: true,
      attemptedAt: i < 5 ? `2026-09-28T20:0${i}:00Z` : `2026-09-28T23:3${i - 5}:00Z`,
    }));
    const utc = computeMastery({ ...base, attempts: evening });
    const tokyo = computeMastery({ ...base, attempts: evening, timeZone: "Asia/Tokyo" });
    expect(utc.practiceDays).toBe(1);
    expect(tokyo.practiceDays).toBe(1);
    const split = [...Array(10)].map<MasteryAttempt>((_, i) => ({
      isCorrect: true,
      attemptedAt: i < 5 ? `2026-09-28T13:0${i}:00Z` : `2026-09-28T16:0${i - 5}:00Z`,
    }));
    // 13:00 UTC = 22:00 Tokyo (28th); 16:00 UTC = 01:00 Tokyo (29th).
    expect(computeMastery({ ...base, attempts: split }).practiceDays).toBe(1);
    expect(computeMastery({ ...base, attempts: split, timeZone: "Asia/Tokyo" }).practiceDays).toBe(2);
    expect(computeMastery({ ...base, attempts: split, timeZone: "Asia/Tokyo" }).status).toBe("MASTERED");
  });
});
