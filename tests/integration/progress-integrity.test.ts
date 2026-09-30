import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AttemptEvent, LessonRunEvent } from "@/lib/offline/sync-protocol";
import { processSyncBatch } from "@/lib/server/progress-writer";
import { levelId, registerParent, serviceClient, type Client } from "./helpers";

// Audit fixes (ADR-028): the server only credits real evidence. A lesson run is scored from
// answers to that lesson's own published questions; draft/archived questions, extra tries
// and replayed first tries are refused; and parents never read stored correct answers or
// links to unpublished content.

type McQuestion = { id: string; answer: { accepted: string[] } };

async function mcQuestions(lessonCode: string, status: "published" | "archived" = "published") {
  const db = serviceClient();
  const { data: lesson } = await db.from("lessons").select("id").eq("code", lessonCode).single();
  const { data: activities } = await db.from("activities").select("id").eq("lesson_id", lesson!.id);
  const { data } = await db
    .from("questions")
    .select("id, answer")
    .in(
      "activity_id",
      activities!.map((a) => a.id),
    )
    .eq("status", status)
    .eq("question_type", "MULTIPLE_CHOICE");
  return { lessonId: lesson!.id, questions: (data ?? []) as unknown as McQuestion[] };
}

const at = () => new Date().toISOString();
const answer = (
  q: McQuestion,
  runId: string | null,
  opts: { attemptNumber?: number; value?: string } = {},
): AttemptEvent => ({
  kind: "attempt",
  id: crypto.randomUUID(),
  questionId: q.id,
  lessonRunId: runId,
  sessionId: null,
  attemptNumber: opts.attemptNumber ?? 1,
  response: { value: opts.value ?? q.answer.accepted[0] },
  responseTimeMs: 1200,
  attemptedAt: at(),
});
const run = (id: string, lessonId: string): LessonRunEvent => ({
  kind: "lesson_run",
  id,
  lessonId,
  startedAt: at(),
  completedAt: at(),
});

describe("progress integrity (real database)", () => {
  let parent: { client: Client; userId: string };
  let childId: string;
  let draftPatternId: string | null = null;

  beforeAll(async () => {
    parent = await registerParent("Integrity");
    const kg1 = await levelId(parent.client, "KG1");
    const { data } = await parent.client
      .from("children")
      .insert({ name: "Ira", grade_level_id: kg1, current_level_id: kg1 })
      .select("id")
      .single();
    childId = data!.id;
  });

  afterAll(async () => {
    if (draftPatternId) await serviceClient().from("phonics_patterns").delete().eq("id", draftPatternId);
  });

  it("does not complete a lesson from an answer to another lesson's question", async () => {
    const letterA = await mcQuestions("kg1-letter-a-1");
    const target = await mcQuestions("g2-suffixes-1");
    const runId = crypto.randomUUID();
    const result = await processSyncBatch(childId, [
      answer(letterA.questions[0], runId),
      run(runId, target.lessonId),
    ]);
    expect(result.results.map((r) => r.status)).toEqual(["stored", "rejected"]);
    expect(result.results[1].reason).toBe("no_attempts_for_run");
    const { data } = await parent.client
      .from("lesson_progress")
      .select("status")
      .eq("child_id", childId)
      .eq("lesson_id", target.lessonId);
    expect(data).toEqual([]);
  });

  it("does not complete a lesson from a stray answer to one of its questions", async () => {
    const lesson = await mcQuestions("kg1-letter-b-1");
    const runId = crypto.randomUUID();
    const result = await processSyncBatch(childId, [
      answer(lesson.questions[0], runId),
      run(runId, lesson.lessonId),
    ]);
    expect(result.results[1]).toMatchObject({ status: "rejected", reason: "incomplete_run" });
  });

  it("refuses answers to archived questions, extra tries and replayed first tries", async () => {
    const archived = await mcQuestions("kg1-letter-a-1", "archived");
    const live = await mcQuestions("kg1-letter-c-1");
    const runId = crypto.randomUUID();
    const q = live.questions[0];
    const result = await processSyncBatch(childId, [
      answer(archived.questions[0], null),
      answer(q, runId, { value: "wrong" }),
      answer(q, runId),
      answer(q, runId, { attemptNumber: 3 }),
    ]);
    expect(result.results.map((r) => r.reason ?? r.status)).toEqual([
      "question_not_available",
      "stored",
      "duplicate_first_try",
      "too_many_tries",
    ]);
    // Also refused when the replay comes in a later request.
    const later = await processSyncBatch(childId, [answer(q, runId)]);
    expect(later.results[0]).toMatchObject({ status: "rejected", reason: "duplicate_first_try" });
  });

  it("never lets a parent read the stored correct answer", async () => {
    const { data, error } = await parent.client
      .from("activity_attempts")
      .select("is_correct")
      .eq("child_id", childId);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    const leak = await parent.client
      .from("activity_attempts")
      .select("correct_answer")
      .eq("child_id", childId);
    expect(leak.error?.message).toMatch(/permission denied/);
  });

  it("hides links to unpublished content from families", async () => {
    const db = serviceClient();
    const { data: level } = await db.from("levels").select("id").eq("code", "KG1").single();
    const { data: pattern } = await db
      .from("phonics_patterns")
      .insert({
        code: `DRAFT_${Date.now()}`,
        pattern: "zz",
        pattern_type: "consonant_digraph",
        level_id: level!.id,
        difficulty: 1,
        status: "draft",
      })
      .select("id")
      .single();
    draftPatternId = pattern!.id;
    await db
      .from("phonics_pattern_sounds")
      .insert({ pattern_id: draftPatternId, code: "ZZ", label: "zz", say_as: "zzz" });
    const { data } = await parent.client
      .from("phonics_pattern_sounds")
      .select("id")
      .eq("pattern_id", draftPatternId);
    expect(data).toEqual([]);
  });
});
