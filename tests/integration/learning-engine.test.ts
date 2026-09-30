import { beforeAll, describe, expect, it } from "vitest";
import type { AnswerSpec, QuestionResponse } from "@/lib/content/question-schemas";
import {
  getNextLesson,
  getRecommendedLessons,
  type CatalogLesson,
  type EngineInput,
} from "@/lib/learning/engine";
import type { MasteryStatus } from "@/lib/learning/mastery";
import { starsFor } from "@/lib/learning/scoring";
import type { AttemptEvent, LessonRunEvent, SyncEvent } from "@/lib/offline/sync-protocol";
import { processSyncBatch } from "@/lib/server/progress-writer";
import { levelId, registerParent, serviceClient, type Client } from "./helpers";

// The learning engine against the real database: a child answers a lesson (through the
// same server code the /api/sync route calls after its ownership check), and every
// derived record — activity, lesson, subject and level progress, skill mastery, the
// review queue and the learning session — is written and visible only to that family.

type Question = { id: string; activity_id: string; question_type: string; answer: AnswerSpec | null };

function correctResponse(q: Question): QuestionResponse {
  const a = q.answer!;
  if ("minCoverage" in a) return { coverage: a.minCoverage + 10 };
  if ("pairs" in a) return { pairs: a.pairs };
  if ("acceptedSequences" in a) return { sequence: a.acceptedSequences[0] };
  if (q.question_type === "WORD_BUILDER") return { sequence: [...a.accepted[0]] };
  return { value: a.accepted[0] };
}
function wrongResponse(q: Question): QuestionResponse {
  const a = q.answer!;
  if ("minCoverage" in a) return { coverage: 0 };
  if ("pairs" in a) return { pairs: [] };
  if ("acceptedSequences" in a) return { sequence: ["nope"] };
  return q.question_type === "WORD_BUILDER" ? { sequence: ["z"] } : { value: "definitely-wrong" };
}

async function lessonQuestions(code: string) {
  const db = serviceClient();
  const { data: lesson } = await db.from("lessons").select("id, skill_id").eq("code", code).single();
  const { data: activities } = await db
    .from("activities")
    .select("id")
    .eq("lesson_id", lesson!.id)
    .eq("status", "published")
    .order("sort_order");
  const { data: questions } = await db
    .from("questions")
    .select("id, activity_id, question_type, answer, sort_order")
    .in(
      "activity_id",
      activities!.map((a) => a.id),
    )
    .eq("status", "published")
    .order("sort_order");
  const order = new Map(activities!.map((a, i) => [a.id, i]));
  const sorted = (questions as unknown as (Question & { sort_order: number })[]).sort(
    (x, y) => order.get(x.activity_id)! - order.get(y.activity_id)! || x.sort_order - y.sort_order,
  );
  return {
    lessonId: lesson!.id,
    skillId: lesson!.skill_id,
    activityIds: activities!.map((a) => a.id),
    questions: sorted,
  };
}

const attempt = (
  q: Question,
  response: QuestionResponse,
  runId: string | null,
  sessionId: string,
  at: string,
  attemptNumber = 1,
): AttemptEvent => ({
  kind: "attempt",
  id: crypto.randomUUID(),
  questionId: q.id,
  lessonRunId: runId,
  sessionId,
  attemptNumber,
  response,
  responseTimeMs: 1500,
  attemptedAt: at,
});

describe("learning engine (real database)", () => {
  let parentA: { client: Client; userId: string };
  let parentB: { client: Client; userId: string };
  let childA: string;
  let childB: string;
  let lesson: Awaited<ReturnType<typeof lessonQuestions>>;
  const sessionId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const scored = () => lesson.questions.filter((q) => q.answer !== null);

  beforeAll(async () => {
    [parentA, parentB] = await Promise.all([registerParent("Engine A"), registerParent("Engine B")]);
    const kg2 = await levelId(parentA.client, "KG2");
    const insert = (client: Client, name: string) =>
      client
        .from("children")
        .insert({ name, grade_level_id: kg2, current_level_id: kg2 })
        .select("id")
        .single();
    const [a, b] = await Promise.all([insert(parentA.client, "Ava"), insert(parentB.client, "Bo")]);
    childA = a.data!.id;
    childB = b.data!.id;
    lesson = await lessonQuestions("kg2-word-games-1");
  });

  it("serves lesson content without answers to families", async () => {
    const hidden = await parentA.client.from("questions").select("id, answer").limit(1);
    expect(hidden.error?.code).toBe("42501");
    const visible = await parentA.client.from("questions").select("id, content").limit(1);
    expect(visible.error).toBeNull();
    expect(visible.data).toHaveLength(1);
    // Draft content stays hidden; the flattened catalog carries the hierarchy.
    const { data } = await parentA.client
      .from("lesson_catalog")
      .select("lesson_code, subject_code, level_code")
      .eq("lesson_code", "kg2-word-games-1")
      .single();
    expect(data).toEqual({ lesson_code: "kg2-word-games-1", subject_code: "GAMES", level_code: "KG2" });
  });

  it("records a part-finished lesson as in progress", async () => {
    const [first] = scored();
    const result = await processSyncBatch(childA, [
      attempt(first, correctResponse(first), runId, sessionId, new Date(Date.now() - 120_000).toISOString()),
    ]);
    expect(result.results.map((r) => r.status)).toEqual(["stored"]);
    const { data } = await parentA.client
      .from("lesson_progress")
      .select("status, attempts, runs_count")
      .eq("child_id", childA)
      .eq("lesson_id", lesson.lessonId)
      .single();
    expect(data).toEqual({ status: "IN_PROGRESS", attempts: 1, runs_count: 0 });
  });

  it("completes the lesson: answers re-scored by the server, every progress level updated", async () => {
    const [, second, ...rest] = scored();
    const t = (s: number) => new Date(Date.now() - 100_000 + s * 1000).toISOString();
    const events: SyncEvent[] = [
      // A wrong first try, then right: the first try is what counts.
      attempt(second, wrongResponse(second), runId, sessionId, t(1)),
      attempt(second, correctResponse(second), runId, sessionId, t(2), 2),
      ...rest.map((q, i) => attempt(q, correctResponse(q), runId, sessionId, t(3 + i))),
    ];
    const run: LessonRunEvent = {
      kind: "lesson_run",
      id: runId,
      lessonId: lesson.lessonId,
      sessionId,
      startedAt: t(0),
      completedAt: t(60),
    };
    const result = await processSyncBatch(childA, [...events, run]);
    expect(result.results.every((r) => r.status === "stored")).toBe(true);
    const total = scored().length;

    const [runRow, attempts, activities, lessonRow, mastery, subject, level, session] = await Promise.all([
      parentA.client
        .from("lesson_runs")
        .select("score_percent, stars, total_questions, correct_count")
        .eq("id", runId)
        .single(),
      parentA.client
        .from("activity_attempts")
        .select("attempt_number, is_correct, score")
        .eq("lesson_run_id", runId),
      parentA.client.from("activity_progress").select("activity_id, status").eq("child_id", childA),
      parentA.client
        .from("lesson_progress")
        .select("status, runs_count, activities_total, activities_completed, completed_at")
        .eq("child_id", childA)
        .eq("lesson_id", lesson.lessonId)
        .single(),
      parentA.client
        .from("skill_mastery")
        .select("status, attempts, correct_attempts, mastery_score")
        .eq("child_id", childA)
        .eq("skill_id", lesson.skillId)
        .single(),
      parentA.client
        .from("subject_progress")
        .select("lessons_completed, lessons_total, status, subjects(code)")
        .eq("child_id", childA),
      parentA.client
        .from("level_progress")
        .select("lessons_completed, lessons_total, levels(code)")
        .eq("child_id", childA),
      parentA.client
        .from("learning_sessions")
        .select(
          "lessons_completed, activities_completed, attempts, correct_attempts, score, duration_seconds",
        )
        .eq("id", sessionId)
        .single(),
    ]);

    const percent = (100 * (total - 1)) / total;
    expect(runRow.data).toMatchObject({
      total_questions: total,
      correct_count: total - 1,
      stars: starsFor(percent),
    });
    expect(Number(runRow.data!.score_percent)).toBeCloseTo(percent, 1);
    // Per-answer scores: 100 first time, 50 after feedback, 0 wrong.
    expect(attempts.data!.map((a) => Number(a.score)).sort((x, y) => x - y)).toEqual(
      [0, 50, ...Array(total - 1).fill(100)].sort((x, y) => x - y),
    );
    expect(
      activities
        .data!.filter((a) => lesson.activityIds.includes(a.activity_id))
        .every((a) => a.status === "COMPLETED"),
    ).toBe(true);
    expect(lessonRow.data).toMatchObject({
      status: "COMPLETED",
      runs_count: 1,
      activities_total: lesson.activityIds.length,
      activities_completed: lesson.activityIds.length,
    });
    // One lesson is never mastery: repeated evidence is required.
    expect(mastery.data!.status).not.toBe("MASTERED");
    expect(mastery.data).toMatchObject({ attempts: total, correct_attempts: total - 1 });

    const games = subject.data!.find(
      (s) => (Array.isArray(s.subjects) ? s.subjects[0] : s.subjects)?.code === "GAMES",
    );
    expect(games).toMatchObject({ lessons_completed: 1, status: "COMPLETED" });
    const kg2 = level.data!.find((l) => (Array.isArray(l.levels) ? l.levels[0] : l.levels)?.code === "KG2");
    expect(kg2!.lessons_completed).toBe(1);
    expect(kg2!.lessons_total).toBeGreaterThan(1);

    expect(session.data).toMatchObject({
      lessons_completed: 1,
      activities_completed: lesson.activityIds.length,
      attempts: total + 1,
      correct_attempts: total,
    });
    expect(session.data!.duration_seconds).toBeGreaterThan(0);
  });

  it("ignores duplicate submissions (offline retries) without changing anything", async () => {
    const before = await parentA.client.from("activity_attempts").select("id").eq("child_id", childA);
    const replay = await processSyncBatch(childA, [
      {
        kind: "lesson_run",
        id: runId,
        lessonId: lesson.lessonId,
        sessionId,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ]);
    expect(replay.results[0].status).toBe("duplicate");
    const after = await parentA.client.from("activity_attempts").select("id").eq("child_id", childA);
    expect(after.data!.length).toBe(before.data!.length);
    const { data } = await parentA.client
      .from("lesson_progress")
      .select("runs_count")
      .eq("child_id", childA)
      .eq("lesson_id", lesson.lessonId)
      .single();
    expect(data!.runs_count).toBe(1);
  });

  it("puts a missed skill on the review queue", async () => {
    const letters = await lessonQuestions("kg1-letter-a-1");
    const wrongs = letters.questions
      .filter((q) => q.answer !== null)
      .map((q, i) =>
        attempt(q, wrongResponse(q), null, sessionId, new Date(Date.now() - 50_000 + i * 1000).toISOString()),
      );
    await processSyncBatch(childA, wrongs);
    const { data } = await parentA.client
      .from("review_items")
      .select("reason, status, lesson_id")
      .eq("child_id", childA)
      .eq("item_key", `skill:${letters.skillId}`)
      .single();
    expect(data).toMatchObject({ reason: "weak_skill", status: "open", lesson_id: letters.lessonId });
    // The words missed on their first try come back too.
    const words = await parentA.client
      .from("review_items")
      .select("reason")
      .eq("child_id", childA)
      .like("item_key", "word:%");
    expect(words.data!.length).toBeGreaterThan(0);
    expect(words.data!.every((w) => w.reason === "missed_word")).toBe(true);
  });

  it("keeps each family's progress private, and never reuses another child's session", async () => {
    for (const table of [
      "activity_progress",
      "subject_progress",
      "level_progress",
      "review_items",
      "learning_sessions",
    ] as const) {
      const { data, error } = await parentB.client.from(table).select("child_id").eq("child_id", childA);
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
    // Child B's device sends an event with child A's session id: stored, but not in A's session.
    const [q] = scored();
    const result = await processSyncBatch(childB, [
      attempt(q, correctResponse(q), null, sessionId, new Date().toISOString()),
    ]);
    expect(result.results[0].status).toBe("stored");
    const { data: session } = await serviceClient()
      .from("learning_sessions")
      .select("child_id, attempts")
      .eq("id", sessionId)
      .single();
    expect(session!.child_id).toBe(childA);
    const { data: stored } = await serviceClient()
      .from("activity_attempts")
      .select("learning_session_id")
      .eq("child_id", childB)
      .single();
    expect(stored!.learning_session_id).toBeNull();
  });

  it("picks the next lesson and recommendations from the stored progress", async () => {
    const { data: catalog } = await parentA.client
      .from("lesson_catalog")
      .select(
        "lesson_id, lesson_title, skill_id, skill_title, subject_id, subject_name, level_id, unit_order, skill_order, lesson_order",
      )
      .eq("level_code", "KG2")
      .order("unit_order")
      .order("skill_order")
      .order("lesson_order");
    const { data: progress } = await parentA.client
      .from("lesson_progress")
      .select("lesson_id, status, best_stars")
      .eq("child_id", childA);
    const path: CatalogLesson[] = catalog!.map((l) => ({
      lessonId: l.lesson_id!,
      title: l.lesson_title!,
      emoji: "",
      estimatedMinutes: 5,
      skillId: l.skill_id!,
      skillTitle: l.skill_title!,
      skillActive: true,
      subjectId: l.subject_id!,
      subjectName: l.subject_name!,
      levelId: l.level_id!,
    }));
    const input: EngineInput = {
      path,
      lessonStates: new Map(
        progress!.map((p) => [p.lesson_id, { status: p.status, bestStars: p.best_stars }]),
      ),
      mastery: new Map<string, MasteryStatus>(),
      prerequisites: new Map(),
      reviewItems: [],
      now: new Date(),
    };
    const next = getNextLesson(input);
    expect(next).not.toBeNull();
    expect(next!.lessonId).not.toBe(lesson.lessonId); // completed lessons are not offered as "next"
    expect(getRecommendedLessons(input)[0].reason).toBe("next");
  });
});
