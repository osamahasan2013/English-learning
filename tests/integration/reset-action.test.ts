import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerSpec, QuestionResponse } from "@/lib/content/question-schemas";
import type { SyncEvent } from "@/lib/offline/sync-protocol";
import { processSyncBatch } from "@/lib/server/progress-writer";
import { anonClient, levelId, registerParent, serviceClient, type Client } from "./helpers";

// Phase 10.1 — the destructive "Reset learning" SERVER ACTION itself
// (src/app/parent/child-actions.ts → resetChildLearning), not the dialog: real auth server,
// real RLS (the action's getOwnedChild reads with the signed-in client), real reset
// function. Only the Next.js request plumbing is replaced: the cookie jar, redirect() (it
// throws, as in Next) and revalidatePath(). A request from the browser can send any child
// id and any typed name; the action must refuse everything but the signed-in parent's own
// child with that child's name.

let currentClient: Client | null = null;
const jar = new Map<string, string>();
const revalidated: string[] = [];

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => currentClient }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => void revalidated.push(path) }));

const { resetChildLearning } = await import("@/app/parent/child-actions");
const { ACTIVE_CHILD_COOKIE } = await import("@/lib/auth/session");
const { loadAdaptive } = await import("@/lib/server/adaptive");

// Every table that holds a child's learning (reset_child_learning; SQL test 012 keeps the
// database list complete).
const LEARNING_TABLES = [
  "assessment_evidence",
  "instructional_readiness",
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

async function learningRows(childId: string) {
  const db = serviceClient();
  const counts: Record<string, number> = {};
  for (const table of LEARNING_TABLES) {
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

async function childRow(childId: string) {
  const { data } = await serviceClient()
    .from("children")
    .select(
      "name, grade_level_id, current_level_id, learning_epoch, learning_reset_at, parent_id, deleted_at",
    )
    .eq("id", childId)
    .single();
  return data!;
}

type Question = { id: string; question_type: string; answer: AnswerSpec | null };
function right(q: Question): QuestionResponse {
  const a = q.answer!;
  if ("pairs" in a) return { pairs: a.pairs };
  if ("acceptedSequences" in a) return { sequence: a.acceptedSequences[0] };
  if ("correct" in a) return { sequence: a.correct };
  if (!("accepted" in a)) throw new Error("no simple answer");
  if (q.question_type === "WORD_BUILDER") return { sequence: [...a.accepted[0]] };
  return { value: a.accepted[0] };
}
function wrong(q: Question): QuestionResponse {
  const a = q.answer!;
  if ("pairs" in a) return { pairs: [] };
  if ("acceptedSequences" in a || "correct" in a) return { sequence: ["nope"] };
  return q.question_type === "WORD_BUILDER" ? { sequence: ["z"] } : { value: "definitely-wrong" };
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
    .select("id, question_type, answer")
    .in(
      "activity_id",
      activities!.map((a) => a.id),
    )
    .eq("status", "published");
  return {
    lessonId: l!.id as string,
    questions: (questions as unknown as Question[]).filter((q) => q.answer && "accepted" in q.answer),
  };
}

// A finished lesson, every answer right or every answer wrong.
function lessonEvents(opts: { ok?: boolean; epoch?: number; minutesAgo?: number } = {}): SyncEvent[] {
  const at = new Date(Date.now() - (opts.minutesAgo ?? 1) * 60_000).toISOString();
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
      response: opts.ok === false ? wrong(q) : right(q),
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

const REJECTED = { ok: false } as const;

describe("Reset learning server action (real auth, RLS and database)", () => {
  let parentA: { client: Client; userId: string };
  let parentB: { client: Client; userId: string };
  let maya: string;
  let omar: string;
  let cy: string;
  let kg2: string;
  let kg3: string;

  beforeAll(async () => {
    [parentA, parentB] = await Promise.all([registerParent("Reset A"), registerParent("Reset B")]);
    kg2 = await levelId(parentA.client, "KG2");
    kg3 = await levelId(parentA.client, "KG3");
    const insert = async (client: Client, name: string, current: string) => {
      const { data, error } = await client
        .from("children")
        .insert({ name, grade_level_id: kg2, current_level_id: current })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    };
    maya = await insert(parentA.client, "Maya", kg3);
    omar = await insert(parentA.client, "Omar", kg2);
    cy = await insert(parentB.client, "Cy", kg2);
    lesson = await loadLesson("kg3-sh-1");
    // Maya: wrong answers first (a weak skill → review), then a finished lesson; Omar and
    // Cy each finish one lesson.
    for (const events of [
      lessonEvents({ ok: false, minutesAgo: 300 }),
      lessonEvents({ ok: false, minutesAgo: 200 }),
    ])
      expect((await processSyncBatch(maya, events)).results.every((r) => r.status === "stored")).toBe(true);
    for (const child of [omar, cy])
      expect(
        (await processSyncBatch(child, lessonEvents())).results.every((r) => r.status === "stored"),
      ).toBe(true);
    // Readiness is computed (and stored) for Maya the way the dashboard does it.
    currentClient = parentA.client;
    await loadAdaptive(maya);
  }, 120_000);

  beforeEach(() => {
    jar.clear();
    revalidated.length = 0;
    currentClient = parentA.client;
  });

  it("Maya has learning, readiness and a review recommendation before any reset", async () => {
    const rows = await learningRows(maya);
    for (const t of ["activity_attempts", "lesson_runs", "skill_mastery", "instructional_readiness"] as const)
      expect(rows[t], t).toBeGreaterThan(0);
    const adaptive = await loadAdaptive(maya);
    expect(adaptive.recommendations.some((r) => r.kind === "review" || r.kind === "repair")).toBe(true);
  });

  it("CASE 2 — wrong name: rejected, nothing deleted", async () => {
    const before = await learningRows(maya);
    const result = await resetChildLearning(maya, "Mia");
    expect(result).toMatchObject(REJECTED);
    expect(result.ok ? "" : result.message).toBe("Type Maya to confirm.");
    expect(await learningRows(maya)).toEqual(before);
    expect((await childRow(maya)).learning_epoch).toBe(0);
    expect(revalidated).toEqual([]);
  });

  it("CASE 3 — empty name: rejected", async () => {
    const before = await learningRows(maya);
    expect(await resetChildLearning(maya, "")).toMatchObject(REJECTED);
    expect(await learningRows(maya)).toEqual(before);
  });

  it("CASE 4 — whitespace-only name: rejected", async () => {
    const before = await learningRows(maya);
    for (const blank of [" ", "   ", "\t\n "])
      expect(await resetChildLearning(maya, blank)).toMatchObject(REJECTED);
    expect(await learningRows(maya)).toEqual(before);
  });

  it("CASE 5 — a sibling's name: rejected (Omar's name does not reset Maya, nor Maya's Omar)", async () => {
    const [mayaBefore, omarBefore] = [await learningRows(maya), await learningRows(omar)];
    expect(await resetChildLearning(maya, "Omar")).toMatchObject(REJECTED);
    expect(await resetChildLearning(omar, "Maya")).toMatchObject(REJECTED);
    // A name that only contains the right one is not it either.
    expect(await resetChildLearning(maya, "Maya Omar")).toMatchObject(REJECTED);
    expect(await learningRows(maya)).toEqual(mayaBefore);
    expect(await learningRows(omar)).toEqual(omarBefore);
  });

  it("CASE 6 — another family's child with that child's correct name: rejected as not found", async () => {
    const before = await learningRows(cy);
    currentClient = parentA.client;
    const result = await resetChildLearning(cy, "Cy");
    expect(result).toEqual({ ok: false, message: "This profile was not found." });
    // And parent B cannot reset parent A's child either.
    currentClient = parentB.client;
    expect(await resetChildLearning(maya, "Maya")).toEqual({
      ok: false,
      message: "This profile was not found.",
    });
    expect(await learningRows(cy)).toEqual(before);
    expect((await childRow(maya)).learning_epoch).toBe(0);
    expect((await childRow(cy)).learning_epoch).toBe(0);
  });

  it("CASE 7 — unauthenticated: sent to sign-in, nothing reset", async () => {
    const before = await learningRows(maya);
    currentClient = anonClient();
    await expect(resetChildLearning(maya, "Maya")).rejects.toThrow(/NEXT_REDIRECT \/login/);
    expect(await learningRows(maya)).toEqual(before);
  });

  it("a device in child mode cannot reset (grown-up gate first)", async () => {
    const before = await learningRows(maya);
    jar.set(ACTIVE_CHILD_COOKIE, maya);
    await expect(resetChildLearning(maya, "Maya")).rejects.toThrow(/NEXT_REDIRECT \/child\/home/);
    expect(await learningRows(maya)).toEqual(before);
  });

  it("CASE 8 — forged or invalid child ids: rejected", async () => {
    const before = await learningRows(maya);
    for (const bad of [
      crypto.randomUUID(),
      "not-a-uuid",
      "",
      "' or 1=1 --",
      `${maya}x`,
      maya.toUpperCase().replace(/-/g, ""),
    ])
      expect(await resetChildLearning(bad, "Maya")).toMatchObject(REJECTED);
    expect(await learningRows(maya)).toEqual(before);
  });

  it("CASE 1 + CASE 9 — the right parent, child and name: reset with the documented semantics", async () => {
    const omarBefore = await learningRows(omar);
    const cyBefore = await learningRows(cy);
    const before = await childRow(maya);
    expect(before.learning_epoch).toBe(0);

    // The name is matched as the dialog does: case and surrounding spaces ignored.
    const result = await resetChildLearning(maya, "  maya ");
    expect(result).toEqual({ ok: true });
    expect(revalidated).toEqual(["/parent", "/child"]);

    // All learning history and every derived cache are gone — evidence and readiness too.
    expect(await learningRows(maya)).toEqual(Object.fromEntries(LEARNING_TABLES.map((t) => [t, 0])));
    // The child stays: same name, parent and grade; learning level back at the grade; a new epoch.
    const after = await childRow(maya);
    expect(after).toMatchObject({
      name: "Maya",
      parent_id: parentA.userId,
      grade_level_id: kg2,
      current_level_id: kg2,
      learning_epoch: 1,
      deleted_at: null,
    });
    expect(after.learning_reset_at).not.toBeNull();

    // Recommendations no longer use the old evidence: readiness is recomputed from nothing
    // (every area at the learning level, no evidence) and nothing is brought back for review.
    const adaptive = await loadAdaptive(maya);
    expect(adaptive.readiness.every((r) => r.source === "default" && r.confidence === "INSUFFICIENT")).toBe(
      true,
    );
    expect(
      adaptive.recommendations.some(
        (r) => r.kind === "review" || r.kind === "repair" || r.kind === "continue",
      ),
    ).toBe(false);

    // Siblings and other families are untouched.
    expect(await learningRows(omar)).toEqual(omarBefore);
    expect(await learningRows(cy)).toEqual(cyBefore);
  });

  it("CASE 9 (continued) — old offline events cannot bring the reset learning back; new learning counts", async () => {
    // A device still holding answers from before the reset (epoch 0), and an older app
    // version that sends no epoch (answers from before the reset time).
    const stale = lessonEvents({ ok: false, epoch: 0, minutesAgo: 5 });
    const legacy = lessonEvents({ ok: false, minutesAgo: 120 });
    const result = await processSyncBatch(maya, [...stale, ...legacy]);
    expect(new Set(result.results.map((r) => r.status))).toEqual(new Set(["obsolete"]));
    const rows = await learningRows(maya);
    expect(rows.activity_attempts + rows.lesson_runs + rows.skill_mastery + rows.review_items).toBe(0);

    // Learning after the reset (epoch 1) is stored as usual.
    const fresh = await processSyncBatch(maya, lessonEvents({ epoch: 1 }));
    expect(fresh.results.every((r) => r.status === "stored")).toBe(true);
    const { data } = await parentA.client.from("lesson_progress").select("runs_count").eq("child_id", maya);
    expect(data).toEqual([{ runs_count: 1 }]);
  });

  it("a second reset needs the name again and moves the epoch on once", async () => {
    expect(await resetChildLearning(maya, "Omar")).toMatchObject(REJECTED);
    expect((await childRow(maya)).learning_epoch).toBe(1);
    expect(await resetChildLearning(maya, "Maya")).toEqual({ ok: true });
    expect((await childRow(maya)).learning_epoch).toBe(2);
    expect(total(await learningRows(maya))).toBe(0);
  });
});
