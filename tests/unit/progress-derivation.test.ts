import { describe, expect, it } from "vitest";
import {
  attemptRejection,
  buildAttemptRow,
  clampTimestamp,
  deriveActivityProgress,
  deriveLessonProgress,
  deriveSession,
  rollUpLessons,
  RUN_MIN_COVERAGE,
  scoreRun,
  type AttemptFact,
  type LessonProgressFact,
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
  sessionId: "s1",
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
        score: 100,
        learning_session_id: "s1",
      },
    });
    expect(wrong).toMatchObject({
      ok: true,
      row: { is_correct: false, error_type: "wrong_choice", score: 0 },
    });
    const retry = buildAttemptRow(question, { ...event("ship"), attemptNumber: 2 }, "child", now);
    expect(retry).toMatchObject({ ok: true, row: { is_correct: true, score: 50 } });
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
    const progress = deriveLessonProgress({
      childId: "c",
      lessonId: "l1",
      runs: [
        { lesson_id: "l1", score_percent: 60, stars: 1, completed_at: "2026-09-28T10:00:00Z" },
        { lesson_id: "l1", score_percent: 90, stars: 3, completed_at: "2026-09-29T10:00:00Z" },
        { lesson_id: "l2", score_percent: 100, stars: 3, completed_at: "2026-09-29T11:00:00Z" },
      ],
      attempts: [],
      activitiesTotal: 3,
      activitiesCompleted: 3,
    });
    expect(progress).toMatchObject({
      status: "COMPLETED",
      runs_count: 2,
      best_score: 90,
      last_score: 90,
      best_stars: 3,
      completed_at: "2026-09-28T10:00:00Z",
      last_completed_at: "2026-09-29T10:00:00Z",
    });
  });
});

const fact = (
  question: string,
  activity: string,
  isCorrect: boolean,
  at: string,
  extra: Partial<AttemptFact> = {},
): AttemptFact => ({
  question_id: question,
  activity_id: activity,
  lesson_id: "l1",
  lesson_run_id: "r1",
  attempt_number: 1,
  is_correct: isCorrect,
  attempted_at: at,
  ...extra,
});

describe("activity and lesson progress", () => {
  const base = {
    childId: "c",
    activityId: "a1",
    lessonId: "l1",
    scoredQuestionIds: ["q1", "q2"],
    lessonCompletedAt: null,
  };

  it("is not started with zero attempts", () => {
    const p = deriveActivityProgress({ ...base, attempts: [] });
    expect(p).toMatchObject({ status: "NOT_STARTED", attempts: 0, accuracy: 0, score: 0, started_at: null });
    expect(
      deriveLessonProgress({
        childId: "c",
        lessonId: "l1",
        runs: [],
        attempts: [],
        activitiesTotal: 2,
        activitiesCompleted: 0,
      }).status,
    ).toBe("NOT_STARTED");
  });

  it("is in progress part-way through (the child stopped early)", () => {
    const attempts = [fact("q1", "a1", true, "2026-09-29T10:00:00Z")];
    expect(deriveActivityProgress({ ...base, attempts })).toMatchObject({
      status: "IN_PROGRESS",
      questions_answered: 1,
      score: 50,
    });
    expect(
      deriveLessonProgress({
        childId: "c",
        lessonId: "l1",
        runs: [],
        attempts,
        activitiesTotal: 2,
        activitiesCompleted: 0,
      }),
    ).toMatchObject({ status: "IN_PROGRESS", attempts: 1, accuracy: 100, completed_at: null });
  });

  it("completes at 100% and at 0% alike, scoring first tries only", () => {
    const perfect = deriveActivityProgress({
      ...base,
      attempts: [
        fact("q1", "a1", true, "2026-09-29T10:00:00Z"),
        fact("q2", "a1", true, "2026-09-29T10:01:00Z"),
      ],
    });
    expect(perfect).toMatchObject({
      status: "COMPLETED",
      score: 100,
      accuracy: 100,
      completed_at: "2026-09-29T10:01:00Z",
    });

    const wrongThenRight = deriveActivityProgress({
      ...base,
      attempts: [
        fact("q1", "a1", false, "2026-09-29T10:00:00Z"),
        fact("q1", "a1", true, "2026-09-29T10:00:30Z", { attempt_number: 2 }),
        fact("q2", "a1", false, "2026-09-29T10:01:00Z"),
        fact("q2", "a1", false, "2026-09-29T10:01:30Z", { attempt_number: 2 }),
      ],
    });
    // 0% on first tries even though a retry was right; every answer counts for accuracy.
    expect(wrongThenRight).toMatchObject({
      status: "COMPLETED",
      score: 0,
      attempts: 4,
      correct_attempts: 1,
      accuracy: 25,
    });
  });

  it("keeps the best run when a lesson is repeated", () => {
    const attempts = [
      fact("q1", "a1", false, "2026-09-28T10:00:00Z", { lesson_run_id: "r1" }),
      fact("q2", "a1", false, "2026-09-28T10:01:00Z", { lesson_run_id: "r1" }),
      fact("q1", "a1", true, "2026-09-29T10:00:00Z", { lesson_run_id: "r2" }),
      fact("q2", "a1", true, "2026-09-29T10:01:00Z", { lesson_run_id: "r2" }),
    ];
    expect(deriveActivityProgress({ ...base, attempts })).toMatchObject({
      score: 100,
      attempts: 4,
      accuracy: 50,
    });
  });

  it("completes an unscored intro activity when its lesson is completed", () => {
    const intro = { ...base, scoredQuestionIds: [], attempts: [] };
    expect(deriveActivityProgress(intro).status).toBe("NOT_STARTED");
    expect(deriveActivityProgress({ ...intro, lessonCompletedAt: "2026-09-29T11:00:00Z" })).toMatchObject({
      status: "COMPLETED",
      completed_at: "2026-09-29T11:00:00Z",
    });
  });
});

describe("subject and level roll-ups", () => {
  const row = (
    id: string,
    status: LessonProgressFact["status"],
    best: number,
  ): [string, LessonProgressFact] => [
    id,
    {
      lesson_id: id,
      status,
      best_score: best,
      attempts: 4,
      correct_attempts: 3,
      started_at: "2026-09-28T10:00:00Z",
      last_attempt_at: "2026-09-29T10:00:00Z",
      completed_at: status === "COMPLETED" ? "2026-09-29T10:00:00Z" : null,
    },
  ];

  it("counts completed lessons and averages their best scores", () => {
    const progress = new Map([
      row("l1", "COMPLETED", 100),
      row("l2", "COMPLETED", 60),
      row("l3", "IN_PROGRESS", 0),
    ]);
    expect(rollUpLessons(["l1", "l2", "l3", "l4"], progress)).toMatchObject({
      status: "IN_PROGRESS",
      lessons_total: 4,
      lessons_completed: 2,
      attempts: 12,
      correct_attempts: 9,
      accuracy: 75,
      score: 80,
      completed_at: null,
    });
  });

  it("is completed only when every lesson is, and not started with nothing", () => {
    const progress = new Map([row("l1", "COMPLETED", 90)]);
    expect(rollUpLessons(["l1"], progress)).toMatchObject({
      status: "COMPLETED",
      completed_at: "2026-09-29T10:00:00Z",
    });
    expect(rollUpLessons(["l9"], progress)).toMatchObject({ status: "NOT_STARTED", accuracy: 0, score: 0 });
    expect(rollUpLessons([], progress).status).toBe("NOT_STARTED");
  });
});

describe("learning sessions", () => {
  it("derives duration, completed lessons and activities, and the first-try score", () => {
    const session = deriveSession({
      sessionId: "s1",
      childId: "c",
      attempts: [
        fact("q1", "a1", true, "2026-09-29T10:00:00Z"),
        fact("q2", "a1", false, "2026-09-29T10:02:00Z"),
        fact("q2", "a1", true, "2026-09-29T10:02:30Z", { attempt_number: 2 }),
        fact("q3", "a2", true, "2026-09-29T10:04:00Z"),
      ],
      runs: [
        {
          id: "r1",
          lesson_id: "l1",
          started_at: "2026-09-29T09:59:00Z",
          completed_at: "2026-09-29T10:05:00Z",
        },
      ],
      activities: new Map([
        ["a0", { lessonId: "l1", scoredQuestions: 0 }],
        ["a1", { lessonId: "l1", scoredQuestions: 2 }],
        ["a2", { lessonId: "l1", scoredQuestions: 2 }],
      ]),
    });
    expect(session).toMatchObject({
      started_at: "2026-09-29T09:59:00Z",
      ended_at: "2026-09-29T10:05:00Z",
      duration_seconds: 360,
      lessons_completed: 1,
      // a1 fully answered + the intro a0 of the completed lesson; a2 only half.
      activities_completed: 2,
      attempts: 4,
      correct_attempts: 3,
      score: 66.67,
    });
  });
});

describe("attemptRejection", () => {
  const inLesson = { activity_id: "a1" };
  const ok = { available: true, maxTries: 2 };
  const answer = (attemptNumber: number, assessmentAttemptId: string | null = null) => ({
    attemptNumber,
    assessmentAttemptId,
  });

  it("accepts a published question within its tries", () => {
    expect(attemptRejection(inLesson, ok, answer(1))).toBeNull();
    expect(attemptRejection(inLesson, ok, answer(2))).toBeNull();
  });

  it("refuses unpublished content, extra tries and stray assessment items", () => {
    expect(attemptRejection(inLesson, { ...ok, available: false }, answer(1))).toBe("question_not_available");
    expect(attemptRejection(inLesson, ok, answer(3))).toBe("too_many_tries");
    expect(attemptRejection({ activity_id: null }, ok, answer(1))).toBe("question_needs_assessment");
  });

  it("allows one try in an assessment sitting", () => {
    expect(attemptRejection({ activity_id: null }, ok, answer(1, "s1"))).toBeNull();
    expect(attemptRejection({ activity_id: null }, ok, answer(2, "s1"))).toBe("too_many_tries");
  });
});

describe("scoreRun", () => {
  const lesson = ["q1", "q2", "q3", "q4"];
  const tries = (...pairs: [string, boolean][]) =>
    pairs.map(([question_id, is_correct]) => ({ question_id, is_correct }));

  it("scores the lesson's own questions only", () => {
    const result = scoreRun(tries(["q1", true], ["q2", true], ["other-lesson", true], ["q3", false]), lesson);
    expect(result).toMatchObject({ ok: true, score: { total: 3, correct: 2 } });
  });

  it("refuses a run with no answers, or answers only to other lessons' questions", () => {
    expect(scoreRun([], lesson)).toEqual({ ok: false, reason: "no_attempts_for_run" });
    expect(scoreRun(tries(["elsewhere", true]), lesson)).toEqual({
      ok: false,
      reason: "no_attempts_for_run",
    });
  });

  it(`needs at least ${RUN_MIN_COVERAGE * 100}% of the lesson's questions answered`, () => {
    expect(scoreRun(tries(["q1", true]), lesson)).toEqual({ ok: false, reason: "incomplete_run" });
    expect(scoreRun(tries(["q1", true], ["q2", true]), lesson)).toMatchObject({ ok: true });
  });
});
