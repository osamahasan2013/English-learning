import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AnswerSpec, QuestionResponse } from "@/lib/content/question-schemas";
import type { SyncEvent } from "@/lib/offline/sync-protocol";
import { processSyncBatch } from "@/lib/server/progress-writer";
import { anonClient, levelId, registerParent, serviceClient, type Client } from "./helpers";

// Phase 8.4 child lifecycle against the real database, auth server and REST API: a parent
// deletes a child or resets a child's learning through the same server module the parent
// settings actions call. The "parent's own RLS client" those use is the signed-in test
// client, so ownership is checked exactly as in production.

let currentClient: Client | null = null;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => currentClient }));
const lifecycle = await import("@/lib/server/child-lifecycle");
const asParent = (client: Client) => (currentClient = client);

// Every table that references children (supabase/tests/012 keeps this list honest).
const CHILD_TABLES = [
  "activity_attempts",
  "assessment_results",
  "assessment_attempts",
  "lesson_runs",
  "reading_sessions",
  "learning_sessions",
  "activity_progress",
  "lesson_progress",
  "subject_progress",
  "level_progress",
  "skill_mastery",
  "review_items",
  "word_progress",
  "word_area_progress",
  "spelling_progress",
  "reward_events",
  "child_achievements",
] as const;

async function childRows(childId: string) {
  const db = serviceClient();
  const counts: Record<string, number> = {};
  for (const table of CHILD_TABLES) {
    const { count, error } = await db
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("child_id", childId);
    if (error) throw error;
    counts[table] = count ?? 0;
  }
  return counts;
}
const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

async function curriculumCounts() {
  const db = serviceClient();
  const out: Record<string, number> = {};
  for (const table of ["lessons", "questions", "words", "skills", "achievements", "levels"] as const) {
    const { count } = await db.from(table).select("*", { count: "exact", head: true });
    out[table] = count ?? 0;
  }
  return out;
}

type Question = { id: string; activity_id: string; question_type: string; answer: AnswerSpec | null };
function correctResponse(q: Question): QuestionResponse {
  const a = q.answer!;
  if ("pairs" in a) return { pairs: a.pairs };
  if ("acceptedSequences" in a) return { sequence: a.acceptedSequences[0] };
  if ("correct" in a) return { sequence: a.correct };
  if (!("accepted" in a)) throw new Error("no simple answer for this question type");
  if (q.question_type === "WORD_BUILDER") return { sequence: [...a.accepted[0]] };
  return { value: a.accepted[0] };
}

let lesson: { lessonId: string; questions: Question[] };
async function loadLesson(code: string) {
  const db = serviceClient();
  const { data: l } = await db.from("lessons").select("id").eq("code", code).single();
  const { data: activities } = await db
    .from("activities")
    .select("id")
    .eq("lesson_id", l!.id)
    .eq("status", "published");
  const { data: questions } = await db
    .from("questions")
    .select("id, activity_id, question_type, answer")
    .in(
      "activity_id",
      activities!.map((a) => a.id),
    )
    .eq("status", "published");
  return {
    lessonId: l!.id,
    questions: (questions as unknown as Question[]).filter((q) => q.answer !== null),
  };
}

// A finished lesson: every scored question answered right, then the run.
function lessonEvents(opts: { epoch?: number; at?: Date } = {}): SyncEvent[] {
  const at = (opts.at ?? new Date()).toISOString();
  const runId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const epoch = opts.epoch !== undefined ? { epoch: opts.epoch } : {};
  return [
    ...lesson.questions.map((q): SyncEvent => ({
      kind: "attempt",
      id: crypto.randomUUID(),
      ...epoch,
      questionId: q.id,
      lessonRunId: runId,
      sessionId,
      attemptNumber: 1,
      response: correctResponse(q),
      responseTimeMs: 1500,
      attemptedAt: at,
    })),
    {
      kind: "lesson_run",
      id: runId,
      ...epoch,
      lessonId: lesson.lessonId,
      sessionId,
      startedAt: at,
      completedAt: at,
    },
  ];
}

describe("child lifecycle (real database)", () => {
  let parentA: { client: Client; userId: string };
  let parentB: { client: Client; userId: string };
  let ana: string;
  let ben: string;
  let cy: string;
  let kg2: string;
  let kg3: string;

  beforeAll(async () => {
    [parentA, parentB] = await Promise.all([registerParent("Lifecycle A"), registerParent("Lifecycle B")]);
    kg2 = await levelId(parentA.client, "KG2");
    kg3 = await levelId(parentA.client, "KG3");
    const insert = (client: Client, name: string, current = kg2) =>
      client
        .from("children")
        .insert({ name, grade_level_id: kg2, current_level_id: current })
        .select("id")
        .single()
        .then((r) => r.data!.id);
    [ana, ben, cy] = await Promise.all([
      insert(parentA.client, "Ana", kg3),
      insert(parentA.client, "Ben"),
      insert(parentB.client, "Cy"),
    ]);
    lesson = await loadLesson("kg2-word-games-1");
    for (const child of [ana, ben, cy]) {
      const result = await processSyncBatch(child, lessonEvents());
      expect(result.results.every((r) => r.status === "stored")).toBe(true);
    }
  });
  afterEach(() => {
    currentClient = null;
  });

  it("a finished lesson fills the child's learning tables", async () => {
    const counts = await childRows(ana);
    for (const table of [
      "activity_attempts",
      "lesson_runs",
      "learning_sessions",
      "activity_progress",
      "lesson_progress",
      "subject_progress",
      "level_progress",
      "skill_mastery",
      "reward_events",
    ])
      expect(counts[table], table).toBeGreaterThan(0);
  });

  it("the browser cannot call the lifecycle functions, signed in or not", async () => {
    for (const client of [parentA.client, anonClient()]) {
      const reset = await client.rpc("reset_child_learning", {
        p_child_id: ana,
        p_parent_id: parentA.userId,
      });
      expect(reset.error?.code).toBe("42501");
      const del = await client.rpc("delete_child", { p_child_id: ana, p_parent_id: parentA.userId });
      expect(del.error?.code).toBe("42501");
    }
    expect(total(await childRows(ana))).toBeGreaterThan(0);
  });

  it("another parent cannot reset or delete the child — the child id is never trusted", async () => {
    const before = await childRows(ana);
    asParent(parentB.client);
    // Parent B's verified id with parent A's child id (a manipulated request body / URL).
    expect(await lifecycle.resetChildLearningForParent(parentB.userId, ana)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await lifecycle.deleteChildForParent(parentB.userId, ana)).toEqual({
      ok: false,
      reason: "not_found",
    });
    // Even with parent A's own session, a forged parent id is refused by the database.
    asParent(parentA.client);
    expect(await lifecycle.resetChildLearningForParent(parentB.userId, ana)).toEqual({
      ok: false,
      reason: "not_found",
    });
    for (const bad of ["not-a-uuid", "", crypto.randomUUID()])
      expect(await lifecycle.deleteChildForParent(parentA.userId, bad)).toEqual({
        ok: false,
        reason: "not_found",
      });
    expect(await childRows(ana)).toEqual(before);
  });

  it("reset: the learning starts again; the child, grade and parent stay; nobody else changes", async () => {
    const benBefore = await childRows(ben);
    const cyBefore = await childRows(cy);
    const curriculum = await curriculumCounts();
    asParent(parentA.client);
    expect(await lifecycle.resetChildLearningForParent(parentA.userId, ana)).toEqual({
      ok: true,
      learningEpoch: 1,
    });

    expect(total(await childRows(ana))).toBe(0);
    const { data: child } = await parentA.client.from("children").select("*").eq("id", ana).single();
    expect(child).toMatchObject({
      name: "Ana",
      grade_level_id: kg2,
      current_level_id: kg2, // learning level back at the grade
      placement_score: null,
      learning_epoch: 1,
    });
    expect(child!.learning_reset_at).not.toBeNull();
    // What the dashboards read is empty for her, unchanged for the others.
    const { data: progress } = await parentA.client
      .from("lesson_progress")
      .select("lesson_id")
      .eq("child_id", ana);
    expect(progress).toEqual([]);
    expect(await childRows(ben)).toEqual(benBefore);
    expect(await childRows(cy)).toEqual(cyBefore);
    expect(await curriculumCounts()).toEqual(curriculum);
    const { data: profile } = await serviceClient().from("profiles").select("id").eq("id", parentA.userId);
    expect(profile).toHaveLength(1);
  });

  it("reset twice is safe: still a clean start, nothing duplicated", async () => {
    asParent(parentA.client);
    expect(await lifecycle.resetChildLearningForParent(parentA.userId, ana)).toEqual({
      ok: true,
      learningEpoch: 2,
    });
    expect(total(await childRows(ana))).toBe(0);
    const { data } = await parentA.client.from("children").select("id").eq("id", ana);
    expect(data).toHaveLength(1);
  });

  it("events recorded before the reset cannot restore the old progress; new learning counts", async () => {
    // An offline device still holding a lesson from before the reset (epoch 0), and one on
    // an app version without epochs (recorded an hour ago).
    const stale = lessonEvents({ epoch: 0 });
    const legacy = lessonEvents({ at: new Date(Date.now() - 3_600_000) });
    const result = await processSyncBatch(ana, [...stale, ...legacy]);
    expect(new Set(result.results.map((r) => r.status))).toEqual(new Set(["obsolete"]));
    expect(total(await childRows(ana))).toBe(0);

    // Learning after the reset is stored as usual.
    const fresh = await processSyncBatch(ana, lessonEvents({ epoch: 2 }));
    expect(fresh.results.every((r) => r.status === "stored")).toBe(true);
    const { data } = await parentA.client.from("lesson_progress").select("runs_count").eq("child_id", ana);
    expect(data).toEqual([{ runs_count: 1 }]);
  });

  it("delete: the child and all their data go; the parent, other children and curriculum stay", async () => {
    const anaBefore = await childRows(ana);
    const cyBefore = await childRows(cy);
    const curriculum = await curriculumCounts();
    asParent(parentA.client);
    expect(await lifecycle.deleteChildForParent(parentA.userId, ben)).toEqual({ ok: true });

    expect(total(await childRows(ben))).toBe(0);
    const { data: gone } = await serviceClient().from("children").select("id").eq("id", ben);
    expect(gone).toEqual([]);
    // The parent now sees only Ana.
    const { data: remaining } = await parentA.client.from("children").select("id");
    expect(remaining!.map((c) => c.id)).toEqual([ana]);
    expect(await childRows(ana)).toEqual(anaBefore);
    expect(await childRows(cy)).toEqual(cyBefore);
    expect(await curriculumCounts()).toEqual(curriculum);
    const { data: user } = await serviceClient().auth.admin.getUserById(parentA.userId);
    expect(user.user?.id).toBe(parentA.userId);
  });

  it("deleting again fails safely, and a deleted child's late events can never be stored", async () => {
    asParent(parentA.client);
    expect(await lifecycle.deleteChildForParent(parentA.userId, ben)).toEqual({
      ok: false,
      reason: "not_found",
    });
    // The sync route answers 410 before writing; the writer itself refuses too.
    await expect(processSyncBatch(ben, lessonEvents())).rejects.toThrow(/child_not_found/);
    const { data } = await serviceClient().from("children").select("id").eq("id", ben);
    expect(data).toEqual([]);
    expect(total(await childRows(ben))).toBe(0);
  });
});
