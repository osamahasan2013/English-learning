import { describe, expect, it } from "vitest";
import {
  aggregateLessonProgress,
  aggregateWordAttempts,
  buildAttemptRow,
  clampTimestamp,
} from "@/lib/learning/progress-derivation";
import type { AttemptEvent } from "@/lib/offline/sync-protocol";

const now = new Date("2026-09-29T12:00:00Z");
const question = {
  id: "q1",
  skill_id: "s1",
  question_type: "MULTIPLE_CHOICE",
  answer: { accepted: ["ship"] },
  version: 3,
  activity_id: "a1",
  lesson_id: "l1",
  word_id: "w1",
};
const event = (value: string): AttemptEvent => ({
  kind: "attempt",
  id: "e1",
  questionId: "q1",
  lessonRunId: "r1",
  attemptNumber: 1,
  response: { value },
  responseTimeMs: 900,
  attemptedAt: "2026-09-29T11:59:00Z",
});

describe("buildAttemptRow", () => {
  it("re-evaluates the answer on the server and snapshots the correct answer", () => {
    const right = buildAttemptRow(question, event("ship"), "child", now);
    const wrong = buildAttemptRow(question, event("chip"), "child", now);
    expect(right).toMatchObject({
      ok: true,
      row: {
        is_correct: true,
        question_version: 3,
        correct_answer: { accepted: ["ship"] },
        child_id: "child",
      },
    });
    expect(wrong).toMatchObject({ ok: true, row: { is_correct: false, error_type: "wrong_choice" } });
  });

  it("rejects responses of the wrong shape and unscored questions", () => {
    expect(buildAttemptRow(question, { ...event("x"), response: { sequence: ["x"] } }, "c", now)).toEqual({
      ok: false,
      reason: "response_shape_invalid",
    });
    expect(
      buildAttemptRow({ ...question, question_type: "INTRO", answer: null }, event("x"), "c", now),
    ).toEqual({ ok: false, reason: "question_not_scored" });
  });
});

describe("clampTimestamp", () => {
  it("keeps plausible device times and clamps impossible ones", () => {
    expect(clampTimestamp("2026-09-29T11:00:00Z", now)).toBe("2026-09-29T11:00:00.000Z");
    expect(clampTimestamp("2030-01-01T00:00:00Z", now)).toBe("2026-09-29T12:05:00.000Z");
    expect(clampTimestamp("2020-01-01T00:00:00Z", now)).toBe("2026-07-31T12:00:00.000Z");
  });
});

describe("aggregations", () => {
  it("derives lesson progress from all runs", () => {
    const progress = aggregateLessonProgress("c", "l1", [
      { lesson_id: "l1", score_percent: 60, stars: 1, completed_at: "2026-09-28T10:00:00Z" },
      { lesson_id: "l1", score_percent: 90, stars: 3, completed_at: "2026-09-29T10:00:00Z" },
      { lesson_id: "l2", score_percent: 100, stars: 3, completed_at: "2026-09-29T11:00:00Z" },
    ]);
    expect(progress).toMatchObject({
      runs_count: 2,
      best_score: 90,
      last_score: 90,
      best_stars: 3,
      first_completed_at: "2026-09-28T10:00:00Z",
    });
  });

  it("counts word attempts", () => {
    const stats = aggregateWordAttempts([
      { word_id: "w1", is_correct: true, attempted_at: "2026-09-28T10:00:00Z" },
      { word_id: "w1", is_correct: false, attempted_at: "2026-09-29T10:00:00Z" },
    ]);
    expect(stats.get("w1")).toEqual({
      attempts_count: 2,
      correct_count: 1,
      last_practiced_at: "2026-09-29T10:00:00Z",
    });
  });
});
