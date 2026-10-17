import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AnswerSpec, QuestionResponse } from "@/lib/content/question-schemas";
import { DOMAINS } from "@/lib/learning/assessment-blueprint";
import type { SyncEvent } from "@/lib/offline/sync-protocol";
import { processSyncBatch } from "@/lib/server/progress-writer";
import { levelId, registerParent, serviceClient, type Client } from "./helpers";

// Phase 10 — the parent experience's loaders against the real database, auth server and
// REST API: they only compose the existing RLS-scoped reads, so a parent sees exactly their
// own children, one child's data never shows up on another's dashboard, every area page
// loads, trends need enough answers, and a family with five children and a long history
// stays responsive.

let currentClient: Client | null = null;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => currentClient }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));
const parentView = await import("@/lib/server/parent-view");
const { loadAdaptive } = await import("@/lib/server/adaptive");
const asParent = (client: Client) => (currentClient = client);

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

async function lessonQuestions(code: string) {
  const db = serviceClient();
  const { data: lesson } = await db.from("lessons").select("id").eq("code", code).single();
  const { data: activities } = await db
    .from("activities")
    .select("id")
    .eq("lesson_id", lesson!.id)
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
    lessonId: lesson!.id as string,
    questions: (questions as unknown as Question[]).filter((q) => q.answer && "accepted" in q.answer),
  };
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

// Plays a lesson `runs` times; each run answers every question right or wrong.
async function playRuns(childId: string, code: string, outcomes: boolean[], startMinutesAgo: number) {
  const lesson = await lessonQuestions(code);
  let minute = startMinutesAgo;
  for (const ok of outcomes) {
    const runId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const startedAt = minutesAgo(minute);
    const events: SyncEvent[] = lesson.questions.map((q) => ({
      kind: "attempt",
      id: crypto.randomUUID(),
      questionId: q.id,
      lessonRunId: runId,
      sessionId,
      attemptNumber: 1,
      response: ok ? right(q) : wrong(q),
      responseTimeMs: 1500,
      attemptedAt: minutesAgo((minute -= 1)),
    }));
    events.push({
      kind: "lesson_run",
      id: runId,
      lessonId: lesson.lessonId,
      sessionId,
      startedAt,
      completedAt: minutesAgo((minute -= 1)),
    });
    const result = await processSyncBatch(childId, events);
    expect(result.results.every((r) => r.status === "stored")).toBe(true);
    minute -= 60;
  }
  return lesson.questions.length;
}

describe("parent experience loaders (real database)", () => {
  let parentA: { client: Client; userId: string };
  let parentB: { client: Client; userId: string };
  let ava: string;
  let ben: string;
  let cy: string;

  beforeAll(async () => {
    [parentA, parentB] = await Promise.all([registerParent("View A"), registerParent("View B")]);
    const kg3 = await levelId(parentA.client, "KG3");
    const insert = async (client: Client, name: string) => {
      const { data, error } = await client
        .from("children")
        .insert({ name, grade_level_id: kg3, current_level_id: kg3 })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    };
    ava = await insert(parentA.client, "Ava");
    ben = await insert(parentA.client, "Ben");
    cy = await insert(parentB.client, "Cy");
    // Ava: two wrong runs, then two right runs of the sh lesson (enough answers for a trend).
    await playRuns(ava, "kg3-sh-1", [false, false, true, true], 3000);
  }, 120_000);

  it("selects only the parent's own child; a crafted or foreign id falls back to their first child", async () => {
    asParent(parentA.client);
    expect((await parentView.loadFamily(ben)).child?.id).toBe(ben);
    expect((await parentView.loadFamily(cy)).child?.id).toBe(ava);
    expect((await parentView.loadFamily("not-a-uuid")).child?.id).toBe(ava);
    expect((await parentView.loadFamily(undefined)).children.map((c) => c.name)).toEqual(["Ava", "Ben"]);
    asParent(parentB.client);
    const b = await parentView.loadFamily(ava);
    expect(b.children.map((c) => c.id)).toEqual([cy]);
    expect(b.child?.id).toBe(cy);
  });

  it("builds Ava's dashboard from her own evidence", async () => {
    asParent(parentA.client);
    const { child } = await parentView.loadFamily(ava);
    const { view, progress } = await parentView.loadParentDashboard(child!, "Europe/London");
    expect(view.levels.map((l) => l.domain)).toEqual([...DOMAINS]);
    const phonics = view.domains.find((d) => d.domain === "PHONICS")!;
    expect(phonics.practised).toBeGreaterThan(0);
    expect(phonics.state).not.toBe("NOT_ENOUGH_EVIDENCE");
    expect(view.recent.filter((r) => r.kind === "lesson")).toHaveLength(4);
    expect(progress.lessonsCompleted).toBe(1);
    // Today and practice come from the one recommender, unchanged.
    const adaptive = await loadAdaptive(ava);
    expect(view.next?.key).toBe(adaptive.recommendations[0]?.key);
    expect(view.today.items.map((i) => i.key)).toEqual(adaptive.plan.map((p) => p.key));
  });

  it("keeps brothers and sisters apart: Ben's dashboard shows none of Ava's learning", async () => {
    asParent(parentA.client);
    const { child } = await parentView.loadFamily(ben);
    const { view } = await parentView.loadParentDashboard(child!, "Europe/London");
    expect(view.recent).toEqual([]);
    expect(view.domains.every((d) => d.state === "NOT_ENOUGH_EVIDENCE")).toBe(true);
    expect(view.strengths).toEqual([]);
    expect(view.attention.map((a) => a.key)).toContain("find-level");
  });

  it("another family cannot read Ava through any parent loader", async () => {
    asParent(parentB.client);
    await expect(loadAdaptive(ava)).rejects.toThrow();
    const skills = parentView.toParentSkills([]);
    const trends = await parentView.loadDomainTrends(ava, skills);
    for (const d of DOMAINS) expect(trends[d].kind).toBe("insufficient");
    // Even with Ava's skill list in hand, the answers themselves are not readable.
    asParent(parentA.client);
    const avaSkills = parentView.toParentSkills(
      (await parentView.loadParentDashboard((await parentView.loadFamily(ava)).child!, "UTC")).progress
        .skills,
    );
    asParent(parentB.client);
    const foreign = await parentView.loadDomainTrends(ava, avaSkills);
    expect(foreign.PHONICS.kind).toBe("insufficient");
  });

  it("shows a trend only with enough answers: Ava's phonics went from wrong to right", async () => {
    asParent(parentA.client);
    const { child } = await parentView.loadFamily(ava);
    const { progress } = await parentView.loadParentDashboard(child!, "UTC");
    const trends = await parentView.loadDomainTrends(ava, parentView.toParentSkills(progress.skills));
    expect(trends.PHONICS.kind).toBe("up");
    expect(trends.READING.kind).toBe("insufficient");
  });

  it("every area page loads its overview (phonics, vocabulary, spelling, reading, writing)", async () => {
    asParent(parentA.client);
    const { child } = await parentView.loadFamily(ava);
    for (const domain of DOMAINS) {
      const o = await parentView.loadDomainOverview(child!, domain);
      expect(o.level.domain).toBe(domain);
      expect(o.snapshot.domain).toBe(domain);
      for (const s of o.skills) expect(s.domain).toBe(domain);
      if (o.next) expect(o.next.domainName).not.toBeNull();
    }
    const phonics = await parentView.loadDomainOverview(child!, "PHONICS");
    expect(phonics.skills.length).toBeGreaterThan(0);
  });

  it("stays responsive for a family of five children with a long history", async () => {
    asParent(parentA.client);
    const kg3 = await levelId(parentA.client, "KG3");
    const extra = await Promise.all(
      ["Dee", "Eli", "Fin"].map(async (name) => {
        const { data, error } = await parentA.client
          .from("children")
          .insert({ name, grade_level_id: kg3, current_level_id: kg3 })
          .select("id")
          .single();
        if (error) throw error;
        return data.id as string;
      }),
    );
    // A long history for one of them: hundreds of first-try answers across areas.
    const db = serviceClient();
    const { data: pool } = await db
      .from("questions")
      .select("id, question_type, answer, activities!inner(status, lessons!inner(status))")
      .eq("status", "published")
      .in("question_type", ["MULTIPLE_CHOICE", "LISTEN_AND_CHOOSE", "SPELLING", "MISSING_LETTER", "READING"])
      .not("activity_id", "is", null)
      .limit(400);
    const usable = (pool as unknown as Question[])
      .filter((q) => q.answer && "accepted" in q.answer)
      .slice(0, 300);
    const events = usable.map((q, i): SyncEvent => ({
      kind: "attempt",
      id: crypto.randomUUID(),
      questionId: q.id,
      lessonRunId: crypto.randomUUID(),
      attemptNumber: 1,
      response: i % 4 === 0 ? wrong(q) : right(q),
      responseTimeMs: 1500,
      attemptedAt: minutesAgo(2000 - i * 5),
    }));
    for (let i = 0; i < events.length; i += 150) await processSyncBatch(extra[0], events.slice(i, i + 150));

    const { children } = await parentView.loadFamily(undefined);
    expect(children).toHaveLength(5);
    const timings: number[] = [];
    for (const child of children) {
      const t0 = performance.now();
      const { view, progress } = await parentView.loadParentDashboard(child, "UTC");
      await parentView.loadDomainTrends(child.id, parentView.toParentSkills(progress.skills));
      timings.push(performance.now() - t0);
      expect(view.domains).toHaveLength(5);
    }
    console.info(`parent dashboard + trends per child (ms): ${timings.map(Math.round).join(", ")}`);
    expect(Math.max(...timings)).toBeLessThan(5000);
  }, 180_000);
});
