import { beforeAll, describe, expect, it } from "vitest";
import type { AnswerSpec, QuestionResponse } from "@/lib/content/question-schemas";
import type { AssessmentRunEvent, AttemptEvent } from "@/lib/offline/sync-protocol";
import { processSyncBatch } from "@/lib/server/progress-writer";
import { levelId, registerParent, serviceClient, type Client } from "./helpers";

// The Phonics Engine against the real database: families read the phoneme inventory,
// patterns and word splits through RLS; a child takes the Phonics Check through the same
// server code the /api/sync route uses, and the result (per area), skill mastery and
// last-assessed times are derived on the server and visible only to that family.

type Item = { question_id: string; stage: number; question_type: string; answer: AnswerSpec };

function correctResponse(type: string, a: AnswerSpec): QuestionResponse {
  if ("pairs" in a) return { pairs: a.pairs };
  if ("acceptedSequences" in a) return { sequence: a.acceptedSequences[0] };
  if ("correct" in a) return { sequence: a.correct };
  if ("minCoverage" in a) return { coverage: a.minCoverage + 10 };
  if (type === "WORD_BUILDER") return { sequence: [...a.accepted[0]] };
  return { value: a.accepted[0] };
}
function wrongResponse(type: string, a: AnswerSpec): QuestionResponse {
  if ("pairs" in a) return { pairs: [] };
  if ("acceptedSequences" in a || "correct" in a) return { sequence: ["nope"] };
  return type === "WORD_BUILDER" ? { sequence: ["z"] } : { value: "definitely-wrong" };
}

describe("phonics engine (real database)", () => {
  let parentA: { client: Client; userId: string };
  let parentB: { client: Client; userId: string };
  let childA: string;
  let childB: string;
  let assessmentId: string;
  let items: Item[];
  const sittingId = crypto.randomUUID();

  beforeAll(async () => {
    [parentA, parentB] = await Promise.all([registerParent("Phonics A"), registerParent("Phonics B")]);
    const kg1 = await levelId(parentA.client, "KG1");
    const insert = (client: Client, name: string) =>
      client
        .from("children")
        .insert({ name, grade_level_id: kg1, current_level_id: kg1 })
        .select("id")
        .single();
    const [a, b] = await Promise.all([insert(parentA.client, "Pia"), insert(parentB.client, "Pat")]);
    childA = a.data!.id;
    childB = b.data!.id;

    const db = serviceClient();
    const { data: assessment } = await db
      .from("assessments")
      .select("id")
      .eq("code", "phonics-check")
      .single();
    assessmentId = assessment!.id;
    const { data } = await db
      .from("assessment_items")
      .select("question_id, stage, sort_order, questions(question_type, answer)")
      .eq("assessment_id", assessmentId)
      .order("stage")
      .order("sort_order");
    items = (data ?? []).map((i) => {
      const q = Array.isArray(i.questions) ? i.questions[0] : i.questions;
      return {
        question_id: i.question_id,
        stage: i.stage,
        question_type: q!.question_type,
        answer: q!.answer as AnswerSpec,
      };
    });
  });

  it("serves phonemes, patterns with their sounds, and word splits to families", async () => {
    const { data: phonemes } = await parentA.client.from("phonemes").select("code, kind");
    expect(phonemes!.length).toBe(39);
    const { data: th } = await parentA.client
      .from("phonics_patterns")
      .select("code, phonics_pattern_sounds(code, phonemes)")
      .eq("code", "TH")
      .single();
    expect(th!.phonics_pattern_sounds.map((s) => s.phonemes[0]).sort()).toEqual(["DH", "TH"]);
    const { data: ship } = await parentA.client
      .from("words")
      .select("phonics_shape, decodable, word_segments(position, grapheme, phonemes)")
      .eq("normalized_word", "ship")
      .single();
    expect(ship!.phonics_shape).toBe("CVC");
    expect([...ship!.word_segments].sort((x, y) => x.position - y.position).map((s) => s.grapheme)).toEqual([
      "sh",
      "i",
      "p",
    ]);
    // Review flags are for admins only.
    const flags = await parentA.client.from("content_flags").select("entity_key");
    expect(flags.data ?? []).toEqual([]);
  });

  it("searches patterns by type with pagination in the database", async () => {
    const { data, count } = await parentA.client
      .from("phonics_patterns")
      .select("code", { count: "exact" })
      .eq("pattern_type", "vowel_team")
      .order("sort_order")
      .range(0, 4);
    expect(data).toHaveLength(5);
    expect(count).toBeGreaterThanOrEqual(10);
  });

  it("scores the Phonics Check per area on the server, once", async () => {
    expect(items.length).toBeGreaterThanOrEqual(20);
    const start = Date.now() - 5 * 60_000;
    // Right on every area except Digraphs (stage 9).
    const events: (AttemptEvent | AssessmentRunEvent)[] = items.map((item, i) => ({
      kind: "attempt",
      id: crypto.randomUUID(),
      questionId: item.question_id,
      lessonRunId: null,
      assessmentId,
      assessmentAttemptId: sittingId,
      attemptNumber: 1,
      response:
        item.stage === 9
          ? wrongResponse(item.question_type, item.answer)
          : correctResponse(item.question_type, item.answer),
      responseTimeMs: 2000,
      attemptedAt: new Date(start + i * 5000).toISOString(),
    }));
    events.push({
      kind: "assessment_run",
      id: sittingId,
      assessmentId,
      startedAt: new Date(start).toISOString(),
      completedAt: new Date(start + items.length * 5000).toISOString(),
    });
    const result = await processSyncBatch(childA, events);
    expect(result.results.every((r) => r.status === "stored")).toBe(true);

    const { data: stored } = await parentA.client
      .from("assessment_results")
      .select("overall_score, dimension_scores, skill_scores")
      .eq("assessment_attempt_id", sittingId)
      .single();
    const areas = stored!.dimension_scores as Record<string, { percent: number; secure: boolean }>;
    expect(areas["Digraphs"]).toMatchObject({ percent: 0, secure: false });
    expect(areas["Letter sounds"]).toMatchObject({ percent: 100, secure: true });
    const digraphItems = items.filter((i) => i.stage === 9).length;
    expect(Number(stored!.overall_score)).toBeCloseTo(
      (100 * (items.length - digraphItems)) / items.length,
      1,
    );

    // Assessment answers feed ordinary skill mastery, and mark the skills as assessed.
    const { data: mastery } = await parentA.client
      .from("skill_mastery")
      .select("status, last_assessed_at, skills!inner(code)")
      .eq("child_id", childA)
      .eq("skills.code", "kg1-letter-m")
      .single();
    expect(mastery!.status).not.toBe("NOT_STARTED");
    expect(mastery!.last_assessed_at).not.toBeNull();

    // The same events again change nothing.
    const again = await processSyncBatch(childA, events);
    expect(again.results.every((r) => r.status === "duplicate")).toBe(true);
    const { count } = await serviceClient()
      .from("assessment_results")
      .select("id", { count: "exact", head: true })
      .eq("assessment_attempt_id", sittingId);
    expect(count).toBe(1);
  });

  it("keeps a family's sitting away from other children and other families", async () => {
    // Another child cannot add answers to (or finish) child A's sitting.
    const hijack = await processSyncBatch(childB, [
      {
        kind: "attempt",
        id: crypto.randomUUID(),
        questionId: items[0].question_id,
        lessonRunId: null,
        assessmentId,
        assessmentAttemptId: sittingId,
        attemptNumber: 1,
        response: correctResponse(items[0].question_type, items[0].answer),
        responseTimeMs: 1000,
        attemptedAt: new Date().toISOString(),
      },
    ]);
    expect(hijack.results[0]).toMatchObject({ status: "rejected", reason: "assessment_attempt_not_owned" });

    // A lesson question cannot be smuggled into an assessment.
    const { data: lessonQuestion } = await serviceClient()
      .from("questions")
      .select("id")
      .not("activity_id", "is", null)
      .eq("status", "published")
      .limit(1)
      .single();
    const smuggled = await processSyncBatch(childB, [
      {
        kind: "attempt",
        id: crypto.randomUUID(),
        questionId: lessonQuestion!.id,
        lessonRunId: null,
        assessmentId,
        assessmentAttemptId: crypto.randomUUID(),
        attemptNumber: 1,
        response: { value: "x" },
        responseTimeMs: 1000,
        attemptedAt: new Date().toISOString(),
      },
    ]);
    expect(smuggled.results[0]).toMatchObject({ status: "rejected", reason: "question_not_in_assessment" });

    // Parent B sees nothing of child A's check.
    const { data } = await parentB.client.from("assessment_results").select("id").eq("child_id", childA);
    expect(data).toEqual([]);
    const { data: attempts } = await parentB.client
      .from("assessment_attempts")
      .select("id")
      .eq("id", sittingId);
    expect(attempts).toEqual([]);
  });
});
