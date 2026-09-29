import { describe, expect, it } from "vitest";
import { currentStreak, dailyActivity, localDate, MAX_COUNTED_RUN_SECONDS } from "@/lib/learning/analytics";

const now = new Date("2026-09-29T10:00:00Z");

describe("localDate", () => {
  it("uses the family's time zone for day boundaries", () => {
    expect(localDate("2026-09-29T22:30:00Z", "UTC")).toBe("2026-09-29");
    expect(localDate("2026-09-29T22:30:00Z", "Asia/Dubai")).toBe("2026-09-30");
  });

  it("falls back to UTC for an invalid time zone", () => {
    expect(localDate("2026-09-29T22:30:00Z", "Not/AZone")).toBe("2026-09-29");
  });
});

describe("dailyActivity", () => {
  it("returns every day in the range, including empty ones, oldest first", () => {
    const result = dailyActivity(
      [
        { completedAt: "2026-09-29T08:00:00Z", durationSeconds: 300, scorePercent: 80 },
        { completedAt: "2026-09-29T09:00:00Z", durationSeconds: 420, scorePercent: 90 },
        { completedAt: "2026-09-27T09:00:00Z", durationSeconds: 60, scorePercent: 50 },
        { completedAt: "2026-08-01T09:00:00Z", durationSeconds: 60, scorePercent: 50 },
      ],
      7,
      "UTC",
      now,
    );
    expect(result).toHaveLength(7);
    expect(result[0].date).toBe("2026-09-23");
    expect(result[6]).toEqual({ date: "2026-09-29", minutes: 12, lessons: 2 });
    expect(result[4]).toEqual({ date: "2026-09-27", minutes: 1, lessons: 1 });
    expect(result[5]).toEqual({ date: "2026-09-28", minutes: 0, lessons: 0 });
  });

  it("caps a single run's counted time", () => {
    const [day] = dailyActivity(
      [{ completedAt: "2026-09-29T08:00:00Z", durationSeconds: 7200, scorePercent: 100 }],
      1,
      "UTC",
      now,
    );
    expect(day.minutes).toBe(MAX_COUNTED_RUN_SECONDS / 60);
  });
});

describe("currentStreak", () => {
  it("counts consecutive days ending today", () => {
    expect(
      currentStreak(
        ["2026-09-29T08:00:00Z", "2026-09-28T08:00:00Z", "2026-09-27T08:00:00Z", "2026-09-25T08:00:00Z"],
        "UTC",
        now,
      ),
    ).toBe(3);
  });

  it("keeps yesterday's streak alive before today's lesson", () => {
    expect(currentStreak(["2026-09-28T08:00:00Z", "2026-09-27T08:00:00Z"], "UTC", now)).toBe(2);
  });

  it("is zero when the last lesson was two days ago", () => {
    expect(currentStreak(["2026-09-27T08:00:00Z"], "UTC", now)).toBe(0);
  });
});
