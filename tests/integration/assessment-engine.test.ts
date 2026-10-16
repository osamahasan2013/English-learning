import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AnswerSpec, QuestionResponse } from "@/lib/content/question-schemas";
import { nextSection, type FlowState } from "@/lib/learning/assessment-flow";
import { syncEventSchema, type SyncEvent } from "@/lib/offline/sync-protocol";
import { processSyncBatch } from "@/lib/server/progress-writer";
import { anonClient, levelId, registerParent, serviceClient, type Client } from "./helpers";

// Phase 9 against the real database, auth server and REST API: sittings are started by the
// server (it selects the questions), answered through the same writer the /api/sync route
// uses, and turned into evidence, results, assessment gaps, instructional readiness and
// adaptive recommendations. Security, lifecycle conflicts, determinism and performance.

let currentClient: Client | null = null;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => currentClient }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));
const engine = await import("@/lib/server/assessment-engine");
const { loadAdaptive } = await import("@/lib/server/adaptive");
const lifecycle = await import("@/lib/server/child-lifecycle");
const asParent = (client: Client) => (currentClient = client);

type Question = { id: string; question_type: string; answer: AnswerSpec; content: { glyph?: string } };

function rightResponse(q: Question): QuestionResponse {
  const a = q.answer;
  if (q.question_type === "TRACING") {
    const code = q.content.glyph ?? "lower-a";
    const letter = code.split("-")[1];
    return { strokes: [], typed: code.startsWith("upper") ? letter.toUpperCase() : letter };
  }
  if ("pairs" in a) return { pairs: a.pairs };
  if ("acceptedSequences" in a) return { sequence: a.acceptedSequences[0] };
  if ("correct" in a) return { sequence: a.correct };
  if (!("accepted" in a)) throw new Error(`no simple answer for ${q.question_type}`);
  if (q.question_type === "WORD_BUILDER") return { sequence: [...a.accepted[0]] };
  return { value: a.accepted[0] };
}
function wrongResponse(q: Question): QuestionResponse {
  if (q.question_type === "TRACING") return { strokes: [], typed: "#" };
  const a = q.answer;
  if ("pairs" in a) return { pairs: [] };
  if ("acceptedSequences" in a || "correct" in a) return { sequence: ["nope"] };
  return q.question_type === "WORD_BUILDER" ? { sequence: ["z"] } : { value: "definitely-wrong" };
}

async function questions(ids: string[]) {
  const { data, error } = await serviceClient()
    .from("questions")
    .select("id, question_type, answer, content")
    .in("id", ids);
  if (error) throw error;
  return new Map((data as unknown as Question[]).map((q) => [q.id, q]));
}

async function sitting(id: string) {
  const { data } = await serviceClient()
    .from("assessment_attempts")
    .select("id, assessment_id, status, item_ids, scope, learning_epoch")
    .eq("id", id)
    .single();
  return data as {
    id: string;
    assessment_id: string;
    status: string;
    item_ids: string[];
    scope: {
      startRank: number;
      sections: { code: string; domain: string; rank: number; passPercent: number }[];
      items: { q: string; s: string }[];
    };
    learning_epoch: number;
  };
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

// Plays a sitting like the lesson player does: sections chosen by the level ladder, each
// section answered right, wrong or "I don't know" by the policy.
async function play(
  childId: string,
  attemptId: string,
  policy: (domain: string, rank: number) => "right" | "wrong" | "skip",
  options: { epoch?: number; finish?: boolean } = {},
) {
  const s = await sitting(attemptId);
  const qs = await questions(s.item_ids);
  const flow: FlowState = {
    rule: "level_ladder",
    startRank: s.scope.startRank,
    passPercent: 75,
    sections: s.scope.sections.map((sec) => ({
      code: sec.code,
      domain: sec.domain,
      rank: sec.rank,
      items: s.scope.items.filter((i) => i.s === sec.code).length,
    })),
    outcomes: {},
  };
  const events: SyncEvent[] = [];
  const served: string[] = [];
  let t = 60;
  for (let section = nextSection(flow); section; section = nextSection(flow)) {
    served.push(section.code);
    const choice = policy(section.domain, section.rank);
    const items = s.scope.items.filter((i) => i.s === section.code);
    for (const item of items) {
      const q = qs.get(item.q)!;
      events.push({
        kind: "attempt",
        id: crypto.randomUUID(),
        epoch: options.epoch,
        questionId: q.id,
        lessonRunId: null,
        assessmentId: s.assessment_id,
        assessmentAttemptId: attemptId,
        attemptNumber: 1,
        response:
          choice === "skip" ? { skipped: true } : choice === "right" ? rightResponse(q) : wrongResponse(q),
        responseTimeMs: 2000,
        attemptedAt: minutesAgo(t--),
      });
    }
    flow.outcomes[section.code] = { correct: choice === "right" ? items.length : 0, total: items.length };
  }
  if (options.finish !== false)
    events.push({
      kind: "assessment_run",
      id: attemptId,
      epoch: options.epoch,
      assessmentId: s.assessment_id,
      startedAt: minutesAgo(61),
      completedAt: minutesAgo(t),
    });
  return { events, served, result: await processSyncBatch(childId, events) };
}

describe("assessment + adaptive engine (real database)", () => {
  let parentA: { client: Client; userId: string };
  let parentB: { client: Client; userId: string };
  let kg3: string;
  let ana: string;
  let placementId: string;
  const newChild = async (client: Client, name: string, level = kg3) =>
    (
      await client
        .from("children")
        .insert({ name, grade_level_id: level, current_level_id: level })
        .select("id")
        .single()
    ).data!.id;

  beforeAll(async () => {
    [parentA, parentB] = await Promise.all([registerParent("Assess A"), registerParent("Assess B")]);
    kg3 = await levelId(parentA.client, "KG3");
    ana = await newChild(parentA.client, "Ana");
  });

  it("starts a placement on the server: representative items per section, the same sitting on resume", async () => {
    asParent(parentA.client);
    const started = await engine.startSitting({ childId: ana, code: "find-my-level", origin: "parent" });
    expect(started).toMatchObject({ ok: true, resumed: false });
    placementId = (started as { attemptId: string }).attemptId;
    const s = await sitting(placementId);
    expect(s.status).toBe("in_progress");
    // School grade KG3 (rank 3), one level below to start.
    expect(s.scope.startRank).toBe(2);
    expect(s.scope.sections).toHaveLength(25);
    for (const section of s.scope.sections)
      expect(s.scope.items.filter((i) => i.s === section.code)).toHaveLength(3);
    expect(new Set(s.item_ids).size).toBe(s.item_ids.length);
    // Starting again resumes the open sitting instead of creating a second one.
    const again = await engine.startSitting({ childId: ana, code: "find-my-level", origin: "child" });
    expect(again).toEqual({ ok: true, attemptId: placementId, resumed: true });
  });

  it("scores the sitting into evidence, results, gaps and per-domain readiness — never the school grade", async () => {
    const policy = (domain: string, rank: number) =>
      domain === "PHONICS"
        ? rank <= 3
          ? "right"
          : "wrong"
        : domain === "READING"
          ? rank <= 1
            ? "right"
            : "wrong"
          : domain === "VOCABULARY"
            ? "right"
            : domain === "SPELLING"
              ? "skip"
              : rank <= 2
                ? "right"
                : "wrong";
    const { result, served } = await play(ana, placementId, policy);
    expect(result.results.filter((r) => r.status !== "stored")).toEqual([]);
    // The ladder never walked every level.
    expect(served.length).toBeLessThan(25);
    expect(served).toContain("phonics-grade1");
    expect(served).not.toContain("phonics-kg1");

    const db = serviceClient();
    const { data: res } = await db
      .from("assessment_results")
      .select("dimension_scores, evidence_summary, readiness, partial")
      .eq("assessment_attempt_id", placementId)
      .single();
    const sections = res!.dimension_scores as Record<
      string,
      { served: boolean; passed: boolean; skipped: number }
    >;
    expect(sections["phonics-kg3"]).toMatchObject({ served: true, passed: true });
    expect(sections["phonics-grade1"]).toMatchObject({ served: true, passed: false });
    expect(sections["phonics-kg1"]).toMatchObject({ served: false });
    expect(sections["spelling-kg2"]).toMatchObject({ served: true, passed: false, skipped: 3 });
    expect(res!.partial).toBe(false);
    expect(Object.keys(res!.readiness as object).sort()).toEqual([
      "PHONICS",
      "READING",
      "SPELLING",
      "VOCABULARY",
      "WRITING",
    ]);

    const { data: evidence } = await parentA.client
      .from("assessment_evidence")
      .select("strength, domain")
      .eq("child_id", ana);
    expect(evidence!.length).toBeGreaterThan(5);

    const { data: readiness } = await parentA.client
      .from("instructional_readiness")
      .select(
        "domain, confidence, source, current_level_id, strongest_level_id, levels!instructional_readiness_current_level_id_fkey(code)",
      )
      .eq("child_id", ana);
    const by = Object.fromEntries(
      (readiness ?? []).map((r) => [
        r.domain,
        { ...r, level: (Array.isArray(r.levels) ? r.levels[0] : r.levels)?.code },
      ]),
    );
    expect(by.PHONICS).toMatchObject({ level: "GRADE1", source: "assessment", confidence: "MEDIUM" });
    expect(by.READING).toMatchObject({ level: "KG2", source: "assessment" });
    expect(by.VOCABULARY).toMatchObject({ level: "GRADE2", source: "assessment" });
    expect(by.SPELLING).toMatchObject({ level: "KG1", source: "assessment" });
    expect(by.WRITING).toMatchObject({ level: "KG3", source: "assessment" });

    // The school grade and the learning level the parent set are untouched.
    const { data: child } = await parentA.client
      .from("children")
      .select("grade_level_id, current_level_id")
      .eq("id", ana)
      .single();
    expect(child).toEqual({ grade_level_id: kg3, current_level_id: kg3 });

    // A skill the check found weak (several items, few right) becomes an assessment gap.
    const { data: gaps } = await parentA.client
      .from("review_items")
      .select("reason, skills(code)")
      .eq("child_id", ana)
      .eq("status", "open")
      .eq("reason", "assessment_gap");
    expect((gaps ?? []).map((g) => (Array.isArray(g.skills) ? g.skills[0] : g.skills)?.code)).toContain(
      "kg1-spell-cvc",
    );
    // The same events again change nothing.
    const { data: before } = await db
      .from("assessment_evidence")
      .select("skill_id")
      .eq("assessment_attempt_id", placementId);
    const s = await sitting(placementId);
    expect(s.status).toBe("completed");
    const { data: after } = await db
      .from("assessment_evidence")
      .select("skill_id")
      .eq("assessment_attempt_id", placementId);
    expect(after!.length).toBe(before!.length);
  });

  it("recommends from the evidence: each domain at its own level, gaps first, the same list every time", async () => {
    asParent(parentA.client);
    const view = await loadAdaptive(ana);
    expect(view.recommendations.length).toBeGreaterThan(0);
    expect(view.recommendations[0].priority).toBe("high");
    expect(view.recommendations.some((r) => r.reasons.some((x) => x.code === "assessment_gap"))).toBe(true);
    const phonics = view.readiness.find((r) => r.domain === "PHONICS")!;
    expect(phonics).toMatchObject({ teachingLevelName: "Grade 1", confidence: "MEDIUM" });
    for (const r of view.recommendations) {
      expect(r.childMessage).not.toMatch(/\d|%/);
      expect(r.parentMessage.length).toBeGreaterThan(0);
    }
    expect(view.plan.reduce((t, p) => t + p.minutes, 0)).toBeLessThanOrEqual(15);
    const again = await loadAdaptive(ana);
    expect(again.recommendations).toEqual(view.recommendations);
  });

  it("re-checks a gap with unseen lesson questions and compares with the earlier sitting", async () => {
    asParent(parentA.client);
    const { data: skill } = await serviceClient()
      .from("skills")
      .select("id")
      .eq("code", "kg1-spell-cvc")
      .single();
    const started = await engine.startSitting({
      childId: ana,
      code: "skill-recheck",
      scope: { skillIds: [skill!.id] },
      origin: "recommendation",
      previousAttemptId: placementId,
    });
    expect(started.ok).toBe(true);
    const id = (started as { attemptId: string }).attemptId;
    const s = await sitting(id);
    expect(s.item_ids.length).toBeGreaterThanOrEqual(3);
    // Only lesson questions of that skill.
    const { data: qs } = await serviceClient()
      .from("questions")
      .select("skill_id, activity_id")
      .in("id", s.item_ids);
    expect(qs!.every((q) => q.skill_id === skill!.id && q.activity_id !== null)).toBe(true);

    const map = await questions(s.item_ids);
    const events: SyncEvent[] = s.item_ids.map((qid, i) => ({
      kind: "attempt",
      id: crypto.randomUUID(),
      questionId: qid,
      lessonRunId: null,
      assessmentId: s.assessment_id,
      assessmentAttemptId: id,
      attemptNumber: 1,
      response: rightResponse(map.get(qid)!),
      responseTimeMs: 1500,
      attemptedAt: minutesAgo(20 - i),
    }));
    events.push({
      kind: "assessment_run",
      id,
      assessmentId: s.assessment_id,
      startedAt: minutesAgo(21),
      completedAt: minutesAgo(10),
    });
    const out = await processSyncBatch(ana, events);
    expect(out.results.every((r) => r.status === "stored")).toBe(true);
    const { data: res } = await serviceClient()
      .from("assessment_results")
      .select("comparison")
      .eq("assessment_attempt_id", id)
      .single();
    const comparison = res!.comparison as {
      previousAttemptId: string;
      skills: { skillId: string; change: string }[];
    };
    expect(comparison.previousAttemptId).toBe(placementId);
    expect(comparison.skills.find((c) => c.skillId === skill!.id)?.change).toBe("improved");
    // The gap is closed by the newer, secure evidence.
    const { data: item } = await parentA.client
      .from("review_items")
      .select("reason, status")
      .eq("child_id", ana)
      .eq("skill_id", skill!.id)
      .maybeSingle();
    expect(item?.reason).not.toBe("assessment_gap");
  });

  it("accepts answers only to the server's selection, honours skip rules, closes finished sittings", async () => {
    asParent(parentA.client);
    const db = serviceClient();
    const placement = await sitting(placementId);
    const lateQuestion = placement.item_ids[0];
    const late = await processSyncBatch(ana, [
      {
        kind: "attempt",
        id: crypto.randomUUID(),
        questionId: lateQuestion,
        lessonRunId: null,
        assessmentId: placement.assessment_id,
        assessmentAttemptId: placementId,
        attemptNumber: 1,
        response: { value: "x" },
        responseTimeMs: 1000,
        attemptedAt: new Date().toISOString(),
      },
    ]);
    expect(late.results[0]).toMatchObject({ status: "rejected", reason: "sitting_closed" });

    // A new sitting: a question it did not select is refused.
    const bo = await newChild(parentA.client, "Bo");
    const started = (await engine.startSitting({ childId: bo, code: "find-my-level", origin: "child" })) as {
      attemptId: string;
    };
    const s = await sitting(started.attemptId);
    const { data: outside } = await db
      .from("assessment_items")
      .select("question_id")
      .eq("assessment_id", s.assessment_id)
      .not("question_id", "in", `(${s.item_ids.join(",")})`)
      .limit(1);
    const base = {
      kind: "attempt" as const,
      lessonRunId: null,
      assessmentId: s.assessment_id,
      attemptNumber: 1,
      responseTimeMs: 1000,
      attemptedAt: new Date().toISOString(),
    };
    if (outside?.length) {
      const r = await processSyncBatch(bo, [
        {
          ...base,
          id: crypto.randomUUID(),
          questionId: outside[0].question_id,
          assessmentAttemptId: started.attemptId,
          response: { value: "x" },
        },
      ]);
      expect(r.results[0]).toMatchObject({ status: "rejected", reason: "question_not_in_sitting" });
    }
    // A sitting the server never started is refused for an assessment that selects items.
    const forged = await processSyncBatch(bo, [
      {
        ...base,
        id: crypto.randomUUID(),
        questionId: s.item_ids[0],
        assessmentAttemptId: crypto.randomUUID(),
        response: { value: "x" },
      },
    ]);
    expect(forged.results[0]).toMatchObject({ status: "rejected", reason: "sitting_not_started" });
    // "I don't know" is stored as not right where allowed…
    const skipped = await processSyncBatch(bo, [
      {
        ...base,
        id: crypto.randomUUID(),
        questionId: s.item_ids[0],
        assessmentAttemptId: started.attemptId,
        response: { skipped: true },
      },
    ]);
    expect(skipped.results[0].status).toBe("stored");
    const { data: row } = await db
      .from("activity_attempts")
      .select("is_correct, error_type, partial_credit, lesson_id")
      .eq("id", skipped.results[0].id)
      .single();
    expect(row).toEqual({ is_correct: false, error_type: "skipped", partial_credit: 0, lesson_id: null });
    // …and refused where the blueprint does not allow it (the Sound Check).
    const { data: check } = await db.from("assessments").select("id").eq("code", "phonics-check").single();
    const { data: checkItem } = await db
      .from("assessment_items")
      .select("question_id")
      .eq("assessment_id", check!.id)
      .limit(1)
      .single();
    const noSkip = await processSyncBatch(bo, [
      {
        ...base,
        id: crypto.randomUUID(),
        assessmentId: check!.id,
        questionId: checkItem!.question_id,
        assessmentAttemptId: crypto.randomUUID(),
        response: { skipped: true },
      },
    ]);
    expect(noSkip.results[0]).toMatchObject({ status: "rejected", reason: "skip_not_allowed" });

    // A parent cancels: the sitting is abandoned, later answers and its finish are refused.
    expect(await engine.abandonSitting(bo, started.attemptId)).toBe(true);
    const afterAbandon = await processSyncBatch(bo, [
      {
        ...base,
        id: crypto.randomUUID(),
        questionId: s.item_ids[1],
        assessmentAttemptId: started.attemptId,
        response: { value: "x" },
      },
      {
        kind: "assessment_run",
        id: started.attemptId,
        assessmentId: s.assessment_id,
        startedAt: minutesAgo(5),
        completedAt: minutesAgo(1),
      },
    ]);
    expect(afterAbandon.results.map((r) => r.reason)).toEqual(["sitting_closed", "sitting_closed"]);

    // Expiry: an open sitting past its time is expired (its answers stay as practice).
    const next = (await engine.startSitting({ childId: bo, code: "find-my-level", origin: "child" })) as {
      attemptId: string;
    };
    await db
      .from("assessment_attempts")
      .update({ expires_at: minutesAgo(1) })
      .eq("id", next.attemptId);
    await engine.expireSittings(db, bo, new Date());
    expect((await sitting(next.attemptId)).status).toBe("expired");
  });

  it("never takes a score, placement, mastery or recommendation from the device", async () => {
    asParent(parentA.client);
    const cy = await newChild(parentA.client, "Cy");
    const started = (await engine.startSitting({ childId: cy, code: "find-my-level", origin: "child" })) as {
      attemptId: string;
    };
    const s = await sitting(started.attemptId);
    const qs = await questions(s.item_ids);
    const q = qs.get(s.item_ids[0])!;
    const forgedAttempt = {
      kind: "attempt",
      id: crypto.randomUUID(),
      questionId: q.id,
      lessonRunId: null,
      assessmentId: s.assessment_id,
      assessmentAttemptId: started.attemptId,
      attemptNumber: 1,
      response: wrongResponse(q),
      responseTimeMs: 1000,
      attemptedAt: minutesAgo(3),
      isCorrect: true,
      score: 100,
      mastery: "MASTERED",
    };
    const forgedRun = {
      kind: "assessment_run",
      id: started.attemptId,
      assessmentId: s.assessment_id,
      startedAt: minutesAgo(4),
      completedAt: minutesAgo(2),
      result: { overall: 100 },
      placement: { PHONICS: "GRADE2" },
      recommendation: ["lesson-x"],
    };
    // The sync protocol drops unknown fields…
    const parsed = syncEventSchema.parse(forgedAttempt) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("isCorrect");
    expect(parsed).not.toHaveProperty("score");
    expect(syncEventSchema.parse(forgedRun)).not.toHaveProperty("placement");
    // …and even passed straight to the writer they change nothing.
    await processSyncBatch(cy, [forgedAttempt, forgedRun] as unknown as SyncEvent[]);
    const db = serviceClient();
    const { data: row } = await db
      .from("activity_attempts")
      .select("is_correct")
      .eq("id", forgedAttempt.id)
      .single();
    expect(row!.is_correct).toBe(false);
    const { data: res } = await db
      .from("assessment_results")
      .select("overall_score")
      .eq("assessment_attempt_id", started.attemptId)
      .single();
    expect(Number(res!.overall_score)).toBe(0);
    const { data: readiness } = await db
      .from("instructional_readiness")
      .select("domain, levels!instructional_readiness_current_level_id_fkey(code)")
      .eq("child_id", cy)
      .eq("domain", "PHONICS")
      .single();
    expect((Array.isArray(readiness!.levels) ? readiness!.levels[0] : readiness!.levels)?.code).not.toBe(
      "GRADE2",
    );
  });

  it("keeps every family's assessments, evidence, readiness and recommendations to itself", async () => {
    asParent(parentB.client);
    expect(await engine.startSitting({ childId: ana, code: "find-my-level", origin: "parent" })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await engine.abandonSitting(ana, placementId)).toBe(false);
    await expect(loadAdaptive(ana)).rejects.toThrow("CHILD_NOT_FOUND");
    for (const table of [
      "assessment_attempts",
      "assessment_results",
      "assessment_evidence",
      "instructional_readiness",
    ] as const) {
      const { data } = await parentB.client.from(table).select("child_id").eq("child_id", ana);
      expect(data ?? [], table).toEqual([]);
      const anon = await anonClient().from(table).select("child_id").eq("child_id", ana);
      expect(anon.data ?? [], `${table} anon`).toEqual([]);
    }
    // Parents can read but never write evidence, readiness, sittings or mastery.
    const { data: level } = await parentA.client.from("levels").select("id").eq("code", "GRADE2").single();
    const insert = await parentA.client.from("instructional_readiness").insert({
      child_id: ana,
      domain: "PHONICS",
      current_level_id: level!.id,
      confidence: "HIGH",
      source: "assessment",
    });
    expect(insert.error).not.toBeNull();
    const update = await parentA.client
      .from("instructional_readiness")
      .update({ confidence: "HIGH" })
      .eq("child_id", ana)
      .select();
    expect(update.data ?? []).toEqual([]);
    const sittingInsert = await parentA.client.from("assessment_attempts").insert({
      id: crypto.randomUUID(),
      child_id: ana,
      assessment_id: (await sitting(placementId)).assessment_id,
      started_at: new Date().toISOString(),
    });
    expect(sittingInsert.error).not.toBeNull();
    const mastery = await parentB.client
      .from("skill_mastery")
      .update({ status: "MASTERED" })
      .eq("child_id", ana)
      .select();
    expect(mastery.data ?? []).toEqual([]);
  });

  it("reset: old assessment state and recommendations are gone, late offline answers cannot bring them back", async () => {
    asParent(parentA.client);
    const dee = await newChild(parentA.client, "Dee");
    const first = (await engine.startSitting({ childId: dee, code: "find-my-level", origin: "child" })) as {
      attemptId: string;
    };
    await play(dee, first.attemptId, (d) => (d === "SPELLING" ? "skip" : "right"), { epoch: 0 });
    const before = await loadAdaptive(dee);
    expect(before.recommendations.some((r) => r.reasons.some((x) => x.code === "assessment_gap"))).toBe(true);
    // An offline device holds an open sitting with answers when the parent resets.
    const offline = (await engine.startSitting({
      childId: dee,
      code: "progress-check",
      origin: "child",
    })) as { attemptId: string };
    expect(await lifecycle.resetChildLearningForParent(parentA.userId, dee)).toEqual({
      ok: true,
      learningEpoch: 1,
    });
    for (const table of [
      "assessment_attempts",
      "assessment_results",
      "assessment_evidence",
      "instructional_readiness",
    ] as const) {
      const { count } = await serviceClient()
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("child_id", dee);
      expect(count, table).toBe(0);
    }
    const after = await loadAdaptive(dee);
    expect(after.recommendations.some((r) => r.reasons.some((x) => x.code === "assessment_gap"))).toBe(false);
    expect(
      after.readiness.every(
        (r) => r.source === "default" || r.source === "inferred" || r.source === "mastery",
      ),
    ).toBe(true);
    // The old device syncs its answers from before the reset: obsolete, nothing restored.
    const late = await processSyncBatch(dee, [
      {
        kind: "attempt",
        id: crypto.randomUUID(),
        epoch: 0,
        questionId: (await serviceClient().from("questions").select("id").limit(1).single()).data!.id,
        lessonRunId: null,
        assessmentId: (
          await serviceClient().from("assessments").select("id").eq("code", "progress-check").single()
        ).data!.id,
        assessmentAttemptId: offline.attemptId,
        attemptNumber: 1,
        response: { value: "x" },
        responseTimeMs: 1000,
        attemptedAt: minutesAgo(30),
      },
    ]);
    expect(late.results[0]).toMatchObject({ status: "obsolete" });
    const { count } = await serviceClient()
      .from("assessment_attempts")
      .select("*", { count: "exact", head: true })
      .eq("child_id", dee);
    expect(count).toBe(0);
  });

  it("delete: a deleted child's offline sitting cannot recreate the child or leave active records", async () => {
    asParent(parentA.client);
    const eve = await newChild(parentA.client, "Eve");
    const open = (await engine.startSitting({ childId: eve, code: "find-my-level", origin: "child" })) as {
      attemptId: string;
    };
    const s = await sitting(open.attemptId);
    expect(await lifecycle.deleteChildForParent(parentA.userId, eve)).toEqual({ ok: true });
    await expect(
      processSyncBatch(eve, [
        {
          kind: "attempt",
          id: crypto.randomUUID(),
          questionId: s.item_ids[0],
          lessonRunId: null,
          assessmentId: s.assessment_id,
          assessmentAttemptId: open.attemptId,
          attemptNumber: 1,
          response: { value: "x" },
          responseTimeMs: 1000,
          attemptedAt: minutesAgo(1),
        },
      ]),
    ).rejects.toThrow(/child_not_found/);
    const db = serviceClient();
    const { count: children } = await db
      .from("children")
      .select("*", { count: "exact", head: true })
      .eq("id", eve);
    expect(children).toBe(0);
    for (const table of ["assessment_attempts", "assessment_evidence", "instructional_readiness"] as const) {
      const { count } = await db.from(table).select("*", { count: "exact", head: true }).eq("child_id", eve);
      expect(count, table).toBe(0);
    }
  });

  it("stays responsive with a realistic history (hundreds of answers)", async () => {
    asParent(parentA.client);
    const fay = await newChild(parentA.client, "Fay");
    const db = serviceClient();
    const { data: lessonQs } = await db
      .from("questions")
      .select("id, question_type, answer, content, activities!inner(status, lessons!inner(status, code))")
      .eq("status", "published")
      .in("question_type", ["MULTIPLE_CHOICE", "LISTEN_AND_CHOOSE", "SPELLING", "MISSING_LETTER", "READING"])
      .not("activity_id", "is", null)
      .limit(400);
    const pool = (lessonQs as unknown as Question[]).filter((q) => q.answer && "accepted" in q.answer);
    expect(pool.length).toBeGreaterThan(150);
    const events: SyncEvent[] = pool.slice(0, 300).map((q, i) => ({
      kind: "attempt",
      id: crypto.randomUUID(),
      questionId: q.id,
      lessonRunId: null,
      attemptNumber: 1,
      response: i % 4 === 0 ? wrongResponse(q) : rightResponse(q),
      responseTimeMs: 1500,
      attemptedAt: minutesAgo(2000 - i * 5),
    }));
    // Practice outside a lesson run is refused for lesson questions, so give each a run.
    const runEvents = events.map((e) => ({ ...e, lessonRunId: crypto.randomUUID() })) as SyncEvent[];
    const t0 = performance.now();
    // Large batches, as an offline device flushes them (up to 200 events per request).
    for (let i = 0; i < runEvents.length; i += 150) await processSyncBatch(fay, runEvents.slice(i, i + 150));
    const writeMs = performance.now() - t0;
    const { count } = await db
      .from("activity_attempts")
      .select("*", { count: "exact", head: true })
      .eq("child_id", fay);
    expect(count).toBeGreaterThanOrEqual(250);
    const t1 = performance.now();
    const view = await loadAdaptive(fay);
    const readMs = performance.now() - t1;
    console.info(
      `performance: ${count} answers written in ${Math.round(writeMs)} ms; adaptive view in ${Math.round(readMs)} ms`,
    );
    expect(view.recommendations.length).toBeGreaterThan(0);
    expect(readMs).toBeLessThan(5000);
  }, 120_000);
});
