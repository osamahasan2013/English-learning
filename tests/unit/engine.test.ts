import { describe, expect, it } from "vitest";
import { parseActivityConfig } from "@/lib/content/activity-config";
import { parseQuestion } from "@/lib/content/question-schemas";
import {
  getNextLesson,
  getRecommendedLessons,
  type CatalogLesson,
  type EngineInput,
} from "@/lib/learning/engine";
import {
  FALLBACK_FEEDBACK,
  feedbackKind,
  pickFeedback,
  renderFeedback,
  type FeedbackMessage,
} from "@/lib/learning/feedback";
import { resolveSession } from "@/lib/learning/learning-session";
import { checkPrerequisites } from "@/lib/learning/prerequisites";
import { deriveSkillReviewItem, deriveWordReviewItem, dueReviewItems } from "@/lib/learning/review-queue";
import { DEFAULT_RULES, mergeLearningRules } from "@/lib/learning/rules";
import { accuracy, attemptScore, percentage, scoreLesson, summarizeAttempts } from "@/lib/learning/scoring";
import { traceCoverage } from "@/lib/learning/tracing";

const now = new Date("2026-09-30T12:00:00Z");

describe("scoring utilities", () => {
  it("handles zero attempts, 0% and 100%", () => {
    expect(percentage(0, 0)).toBe(0);
    expect(accuracy(0, 0)).toBe(0);
    expect(scoreLesson([])).toEqual({ total: 0, correct: 0, percent: 0, stars: 0, points: 0 });
    expect(scoreLesson([{ isCorrect: false }, { isCorrect: false }])).toMatchObject({ percent: 0, stars: 1 });
    expect(scoreLesson([{ isCorrect: true }, { isCorrect: true }])).toMatchObject({
      percent: 100,
      stars: 3,
      points: 35,
    });
    expect(percentage(2, 3)).toBe(66.67);
  });

  it("scores each answer: right first time, right after feedback, wrong", () => {
    expect(attemptScore(true, 1)).toBe(100);
    expect(attemptScore(true, 2)).toBe(50);
    expect(attemptScore(false, 1)).toBe(0);
  });

  it("summarises attempts with raw score, percentage, accuracy and time, counting a repeated first try once", () => {
    const summary = summarizeAttempts(
      [
        { questionId: "q1", attemptNumber: 1, isCorrect: true, responseTimeMs: 2000 },
        { questionId: "q2", attemptNumber: 1, isCorrect: false, responseTimeMs: 4000 },
        { questionId: "q2", attemptNumber: 2, isCorrect: true, responseTimeMs: 3000 },
        // A duplicate of q1's first try (e.g. replayed offline) does not count twice.
        { questionId: "q1", attemptNumber: 1, isCorrect: false, responseTimeMs: 1000 },
      ],
      4,
    );
    expect(summary).toEqual({
      attempts: 4,
      correctAttempts: 2,
      accuracy: 50,
      questionsAnswered: 2,
      rawScore: 1,
      percent: 25,
      totalTimeMs: 10000,
      averageTimeMs: 2500,
    });
  });
});

describe("learning rules", () => {
  it("merges valid overrides and ignores invalid ones", () => {
    const { rules, errors } = mergeLearningRules([
      { code: "player", config: { maxTries: 3 } },
      { code: "mastery", config: { bands: { practicing: 80, almostMastered: 70, mastered: 90 } } },
      { code: "nonsense", config: {} },
    ]);
    expect(rules.player.maxTries).toBe(3);
    expect(rules.player.sessionTimeoutMinutes).toBe(30);
    expect(rules.mastery.bands).toEqual(DEFAULT_RULES.mastery.bands);
    expect(errors).toHaveLength(2);
  });
});

describe("feedback", () => {
  const messages: FeedbackMessage[] = [
    { kind: "CORRECT", text: "Yes!", speech: "", emoji: "✓" },
    { kind: "CORRECT", text: "Great!", speech: "", emoji: "✓" },
    { kind: "INCORRECT", text: "The answer is {answer}.", speech: "It is {answer}.", emoji: "💡" },
  ];

  it("chooses the kind from the result and tries left", () => {
    expect(feedbackKind({ isCorrect: true, almost: false, attemptNumber: 2, maxTries: 2 })).toBe("CORRECT");
    expect(feedbackKind({ isCorrect: false, almost: false, attemptNumber: 1, maxTries: 2 })).toBe(
      "TRY_AGAIN",
    );
    expect(feedbackKind({ isCorrect: false, almost: true, attemptNumber: 1, maxTries: 2 })).toBe(
      "ALMOST_CORRECT",
    );
    expect(feedbackKind({ isCorrect: false, almost: true, attemptNumber: 2, maxTries: 2 })).toBe("INCORRECT");
  });

  it("rotates configured messages and fills in the answer", () => {
    expect(pickFeedback(messages, "CORRECT", 0).text).toBe("Yes!");
    expect(pickFeedback(messages, "CORRECT", 1).text).toBe("Great!");
    expect(renderFeedback(pickFeedback(messages, "INCORRECT", 0), { answer: "ship" })).toEqual({
      text: "The answer is ship.",
      speech: "It is ship.",
      emoji: "💡",
    });
  });

  it("falls back when a kind has no message, and never says an empty answer", () => {
    expect(pickFeedback(messages, "TRY_AGAIN", 0)).toBe(FALLBACK_FEEDBACK.TRY_AGAIN);
    expect(pickFeedback(messages, "INCORRECT", 0, { hasAnswer: false }).text).not.toContain("{answer}");
  });
});

describe("prerequisites", () => {
  const base = {
    skills: [{ skillId: "letter-sounds", title: "Letter sounds", lessonId: "l-sounds" }],
    lessons: [],
    completedLessonIds: new Set<string>(),
  };

  it("recommends the prerequisite and allows a preview when it is not ready", () => {
    const check = checkPrerequisites({ ...base, mastery: new Map([["letter-sounds", "LEARNING"]]) });
    expect(check).toMatchObject({
      ready: false,
      recommendation: { lessonId: "l-sounds", title: "Letter sounds" },
      previewSteps: 3,
    });
  });

  it("is ready from PRACTICING (configurable) and when lesson prerequisites are completed", () => {
    expect(checkPrerequisites({ ...base, mastery: new Map([["letter-sounds", "PRACTICING"]]) }).ready).toBe(
      true,
    );
    expect(
      checkPrerequisites({
        ...base,
        mastery: new Map([["letter-sounds", "PRACTICING"]]),
        rules: { minStatus: "MASTERED", previewSteps: 2 },
      }),
    ).toMatchObject({ ready: false, previewSteps: 2 });
    const lessons = [{ lessonId: "l0", title: "First" }];
    expect(checkPrerequisites({ ...base, skills: [], lessons, mastery: new Map() }).ready).toBe(false);
    expect(
      checkPrerequisites({
        ...base,
        skills: [],
        lessons,
        mastery: new Map(),
        completedLessonIds: new Set(["l0"]),
      }).ready,
    ).toBe(true);
  });

  it("assumes skills below the child's level are known until practice shows otherwise", () => {
    const skills = [{ ...base.skills[0], belowLevel: true }];
    expect(checkPrerequisites({ ...base, skills, mastery: new Map() }).ready).toBe(true);
    expect(
      checkPrerequisites({ ...base, skills, mastery: new Map([["letter-sounds", "LEARNING"]]) }).ready,
    ).toBe(false);
  });
});

describe("lesson selection", () => {
  const lesson = (id: string, skillId: string, extra: Partial<CatalogLesson> = {}): CatalogLesson => ({
    lessonId: id,
    title: id,
    emoji: "",
    estimatedMinutes: 5,
    skillId,
    skillTitle: skillId,
    skillActive: true,
    subjectId: "phonics",
    subjectName: "Phonics",
    levelId: "kg2",
    ...extra,
  });
  const input = (over: Partial<EngineInput> = {}): EngineInput => ({
    path: [lesson("l1", "s1"), lesson("l2", "s2"), lesson("l3", "s3")],
    lessonStates: new Map(),
    mastery: new Map(),
    prerequisites: new Map([
      ["l2", { skills: [{ skillId: "s1", title: "S1", lessonId: "l1" }], lessons: [] }],
      ["l3", { skills: [], lessons: [] }],
    ]),
    reviewItems: [],
    now,
    ...over,
  });

  it("picks the first unfinished lesson whose prerequisites are ready", () => {
    expect(getNextLesson(input())?.lessonId).toBe("l1");
    const afterFirst = input({ lessonStates: new Map([["l1", { status: "COMPLETED", bestStars: 3 }]]) });
    // l2 needs s1 practised; l3 is ready, so it comes first.
    expect(getNextLesson(afterFirst)?.lessonId).toBe("l3");
    const practised = { ...afterFirst, mastery: new Map([["s1", "PRACTICING" as const]]) };
    expect(getNextLesson(practised)?.lessonId).toBe("l2");
  });

  it("skips inactive skills and returns null when everything is done", () => {
    expect(getNextLesson(input({ path: [lesson("l1", "s1", { skillActive: false })] }))).toBeNull();
    const done = input({
      path: [lesson("l1", "s1")],
      lessonStates: new Map([["l1", { status: "COMPLETED", bestStars: 1 }]]),
    });
    expect(getNextLesson(done)).toBeNull();
  });

  it("recommends continuing, then next, then due reviews, with reasons", () => {
    const recs = getRecommendedLessons(
      input({
        lessonStates: new Map([["l3", { status: "IN_PROGRESS", bestStars: 0 }]]),
        reviewItems: [
          {
            itemKey: "skill:s9",
            skillId: "s9",
            wordId: null,
            lessonId: "old",
            priority: 80,
            dueAt: "2026-09-29T00:00:00Z",
            reason: "weak_skill",
            status: "open",
            lessonTitle: "Old lesson",
          },
          {
            itemKey: "skill:s8",
            skillId: "s8",
            wordId: null,
            lessonId: "later",
            priority: 90,
            dueAt: "2026-10-09T00:00:00Z",
            reason: "due_review",
            status: "open",
          },
        ],
      }),
    );
    expect(recs.map((r) => [r.lessonId, r.reason])).toEqual([
      ["l3", "continue"],
      ["l1", "next"],
      ["old", "review"],
    ]);
  });
});

describe("review queue", () => {
  const skill = {
    skillId: "s1",
    lessonId: "l1",
    phonicsPatternId: null,
    active: true,
    status: "PRACTICING" as const,
    masteryScore: 75,
    attempts: 10,
    reviewPriority: 30,
    nextReviewAt: "2026-10-02T12:00:00Z",
    recentErrors: 0,
  };

  it("schedules practised skills, sooner when weak or recently missed", () => {
    expect(deriveSkillReviewItem(skill, now)).toMatchObject({
      reason: "due_review",
      due_at: "2026-10-02T12:00:00Z",
    });
    expect(deriveSkillReviewItem({ ...skill, masteryScore: 50 }, now)).toMatchObject({
      reason: "weak_skill",
      due_at: now.toISOString(),
    });
    expect(deriveSkillReviewItem({ ...skill, recentErrors: 3 }, now)?.reason).toBe("recent_errors");
    expect(deriveSkillReviewItem({ ...skill, attempts: 0, status: "NOT_STARTED" }, now)).toBeNull();
    expect(deriveSkillReviewItem({ ...skill, active: false }, now)).toBeNull();
  });

  it("brings back a missed word until it is answered correctly", () => {
    const word = { wordId: "w1", skillId: "s1", lessonId: "l1" };
    const missed = deriveWordReviewItem(
      { ...word, attempts: [{ isCorrect: false, attemptedAt: "2026-09-29T10:00:00Z" }] },
      now,
    );
    expect(missed).toMatchObject({ item_key: "word:w1", reason: "missed_word", priority: 55 });
    const fixed = deriveWordReviewItem(
      {
        ...word,
        attempts: [
          { isCorrect: false, attemptedAt: "2026-09-29T10:00:00Z" },
          { isCorrect: true, attemptedAt: "2026-09-30T10:00:00Z" },
        ],
      },
      now,
    );
    expect(fixed).toBeNull();
    const old = deriveWordReviewItem(
      { ...word, attempts: [{ isCorrect: false, attemptedAt: "2026-08-01T10:00:00Z" }] },
      now,
    );
    expect(old).toBeNull();
  });

  it("lists due items, most urgent first", () => {
    const item = (key: string, priority: number, dueAt: string) => ({
      itemKey: key,
      skillId: null,
      wordId: null,
      lessonId: null,
      priority,
      dueAt,
      reason: "due_review" as const,
      status: "open" as const,
    });
    const due = dueReviewItems(
      [
        item("a", 10, "2026-09-29T00:00:00Z"),
        item("b", 90, "2026-09-30T00:00:00Z"),
        item("c", 99, "2026-10-05T00:00:00Z"),
      ],
      now,
    );
    expect(due.map((d) => d.itemKey)).toEqual(["b", "a"]);
  });
});

describe("learning sessions on the device", () => {
  let n = 0;
  const newId = () => `id-${++n}`;
  it("continues within the timeout and starts a new session after it", () => {
    const first = resolveSession(null, 0, 30, newId);
    const same = resolveSession(first, 10 * 60_000, 30, newId);
    expect(same.id).toBe(first.id);
    const later = resolveSession(same, 10 * 60_000 + 31 * 60_000, 30, newId);
    expect(later.id).not.toBe(first.id);
    // A clock that went backwards starts a new session rather than extending an old one.
    expect(resolveSession(later, 0, 30, newId).id).not.toBe(later.id);
  });
});

describe("tracing", () => {
  const W = 10;
  const grid = (cells: [number, number][]) => {
    const g = Array<boolean>(W * W).fill(false);
    for (const [x, y] of cells) g[y * W + x] = true;
    return g;
  };
  const letter = grid(Array.from({ length: 8 }, (_, i) => [5, i + 1] as [number, number]));

  it("scores strokes along the letter high and scribbles low", () => {
    expect(traceCoverage(letter, letter, W)).toBe(100);
    const half = grid(Array.from({ length: 3 }, (_, i) => [5, i + 1] as [number, number]));
    expect(traceCoverage(letter, half, W)).toBeLessThan(70);
    const everywhere = Array<boolean>(W * W).fill(true);
    expect(traceCoverage(letter, everywhere, W)).toBeLessThan(60);
    expect(traceCoverage(letter, grid([]), W)).toBe(0);
  });
});

describe("activity configuration", () => {
  it("accepts valid config and rejects unknown keys or bad values before publishing", () => {
    expect(parseActivityConfig("MULTIPLE_CHOICE", {}).ok).toBe(true);
    expect(parseActivityConfig("MULTIPLE_CHOICE", { maxTries: 3 }).ok).toBe(true);
    expect(parseActivityConfig("MULTIPLE_CHOICE", { maxTries: 9 }).ok).toBe(false);
    expect(parseActivityConfig("SPELLING", { surprise: true }).ok).toBe(false);
    expect(parseActivityConfig("READING", {}).ok).toBe(false); // a reading activity needs its passage
    expect(parseActivityConfig("READING", { passage: { text: "A cat sat." } })).toMatchObject({
      ok: true,
      config: { readAloud: true },
    });
    expect(parseActivityConfig("NOPE", {}).ok).toBe(false);
  });

  it("validates the new question types' cross-field rules", () => {
    expect(
      parseQuestion(
        "MATCH",
        { left: [{ id: "a" }, { id: "b" }], right: [{ id: "x" }, { id: "y" }] },
        {
          pairs: [
            ["a", "x"],
            ["a", "y"],
          ],
        },
      ).ok,
    ).toBe(false);
    expect(
      parseQuestion(
        "SORT",
        {
          groups: [
            { id: "g", label: "G" },
            { id: "h", label: "H" },
          ],
          items: [{ id: "a" }, { id: "b" }],
        },
        { pairs: [["a", "g"]] },
      ).ok,
    ).toBe(false);
    expect(
      parseQuestion(
        "DRAG_DROP",
        { parts: [{ text: "The" }, { blank: true }], bank: ["cat", "dog"] },
        { acceptedSequences: [["cow"]] },
      ).ok,
    ).toBe(false);
    expect(parseQuestion("WRITING", { wordBank: ["cat", "dog"] }, { accepted: ["cow"] }).ok).toBe(false);
    expect(parseQuestion("TRACING", { letter: "a" }, { minCoverage: 60 }).ok).toBe(true);
  });
});
