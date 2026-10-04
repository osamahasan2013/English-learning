import { beforeAll, describe, expect, it } from "vitest";
import type { QuestionResponse } from "@/lib/content/question-schemas";
import { buildAnswerKey } from "@/lib/learning/answer-key";
import { glyphStrokesSchema, type TraceGlyph } from "@/lib/learning/tracing";
import { resolveWritingSettings } from "@/lib/learning/writing-evaluation";
import type { AttemptEvent } from "@/lib/offline/sync-protocol";
import { processSyncBatch } from "@/lib/server/progress-writer";
import { correctWritingResponse, strokesOf, wrongWritingResponse } from "../writing-helpers";
import { levelId, registerParent, serviceClient, type Client } from "./helpers";

// Phase 8 through the real database, auth server and REST API: written answers (strokes,
// sentences, guided writing, story writing, edits) are judged on the server from the stored
// question — never from a verdict or score the device sends — and stored once with the
// child's own text and the server's writing analysis; they feed ordinary skill mastery and
// the review queue (letters formed wrongly come back as writing:<glyph>); families read
// glyphs but not rubrics or answers, and never another family's writing.

type Q = {
  id: string;
  question_type: string;
  content: Record<string, unknown>;
  answer: Record<string, unknown>;
  skill_id: string;
  glyph_id: string | null;
};

async function lessonQuestions(code: string): Promise<Q[]> {
  const db = serviceClient();
  const { data: lesson } = await db.from("lessons").select("id").eq("code", code).single();
  const { data: activities } = await db
    .from("activities")
    .select("id, sort_order")
    .eq("lesson_id", lesson!.id)
    .eq("status", "published")
    .order("sort_order");
  const { data } = await db
    .from("questions")
    .select("id, question_type, content, answer, skill_id, glyph_id, activity_id, sort_order")
    .in(
      "activity_id",
      activities!.map((a) => a.id),
    )
    .eq("status", "published");
  const order = new Map(activities!.map((a, i) => [a.id, i]));
  return (data as unknown as (Q & { activity_id: string; sort_order: number })[]).sort(
    (x, y) => order.get(x.activity_id)! - order.get(y.activity_id)! || x.sort_order - y.sort_order,
  );
}

async function glyphOf(q: Q): Promise<TraceGlyph | null> {
  if (!q.glyph_id) return null;
  const { data } = await serviceClient().from("handwriting_glyphs").select("*").eq("id", q.glyph_id).single();
  return {
    code: data!.code,
    kind: data!.kind as TraceGlyph["kind"],
    character: data!.character,
    letterCase: data!.letter_case as TraceGlyph["letterCase"],
    name: data!.name,
    strokes: glyphStrokesSchema.parse(data!.strokes),
    guide: {},
    tolerance: Number(data!.tolerance),
    completion: Number(data!.completion),
    formationTip: "",
    formationSpeech: "",
  };
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const attempt = (q: Q, response: QuestionResponse, at: string, attemptNumber = 1): AttemptEvent => ({
  kind: "attempt",
  id: crypto.randomUUID(),
  questionId: q.id,
  lessonRunId: null,
  sessionId: null,
  attemptNumber,
  response,
  responseTimeMs: 4000,
  attemptedAt: at,
});

describe("writing engine (real database)", () => {
  let parent: { client: Client; userId: string };
  let other: { client: Client; userId: string };
  let childId: string;
  let otherChildId: string;

  beforeAll(async () => {
    [parent, other] = await Promise.all([registerParent("Write A"), registerParent("Write B")]);
    const g1 = await levelId(parent.client, "GRADE1");
    const { data } = await parent.client
      .from("children")
      .insert({ name: "Wren", grade_level_id: g1, current_level_id: g1 })
      .select("id")
      .single();
    childId = data!.id;
    const { data: o } = await other.client
      .from("children")
      .insert({ name: "Otto", grade_level_id: g1, current_level_id: g1 })
      .select("id")
      .single();
    otherChildId = o!.id;
  });

  it("judges handwriting from the strokes on the server; a claimed score is rejected", async () => {
    const [traceA] = await lessonQuestions("kg1-trace-letters-1");
    expect(traceA.question_type).toBe("TRACING");
    const glyph = (await glyphOf(traceA))!;
    const good = attempt(traceA, { strokes: strokesOf(glyph) }, minutesAgo(30));
    const scribble = attempt(traceA, wrongWritingResponse("TRACING", traceA.content), minutesAgo(29));
    const forged = attempt(traceA, { coverage: 100 } as never, minutesAgo(28));
    const result = await processSyncBatch(childId, [good, scribble, forged]);
    expect(result.results.map((r) => r.status)).toEqual(["stored", "stored", "rejected"]);
    const { data: rows } = await parent.client
      .from("activity_attempts")
      .select("id, is_correct, error_type, writing_analysis, response")
      .in("id", [good.id, scribble.id])
      .order("attempted_at");
    expect(rows!.map((r) => r.is_correct)).toEqual([true, false]);
    expect(rows![1].error_type).toBe("incomplete_trace");
    expect(rows![0].writing_analysis).toMatchObject({
      kind: "trace",
      trace: { glyph: "lower-a", method: "draw" },
    });
    expect((rows![0].response as { strokes: number[][][] }).strokes.length).toBe(glyph.strokes.length);
  });

  it("brings a letter back for review after repeated misses, and resolves it", async () => {
    const [, traceC] = await lessonQuestions("kg1-trace-letters-1");
    const glyph = (await glyphOf(traceC))!;
    const miss = () => attempt(traceC, wrongWritingResponse("TRACING", traceC.content), minutesAgo(20));
    await processSyncBatch(childId, [miss(), { ...miss(), attemptedAt: minutesAgo(19) }]);
    const key = `writing:${traceC.glyph_id}`;
    const open = await parent.client
      .from("review_items")
      .select("item_key, reason, status, glyph_id, lesson_id")
      .eq("child_id", childId)
      .eq("item_key", key)
      .single();
    expect(open.data).toMatchObject({ reason: "writing_letter", status: "open", glyph_id: traceC.glyph_id });
    expect(open.data!.lesson_id).not.toBeNull();
    const right = () => attempt(traceC, { strokes: strokesOf(glyph) }, minutesAgo(10));
    await processSyncBatch(childId, [right(), { ...right(), attemptedAt: minutesAgo(9) }]);
    const done = await parent.client
      .from("review_items")
      .select("status")
      .eq("child_id", childId)
      .eq("item_key", key)
      .single();
    expect(done.data!.status).toBe("done");
  });

  it("checks typed writing on the server: copy, free writing by rubric, story order, editing", async () => {
    const settings = resolveWritingSettings("GRADE1");
    const cases: Q[] = [
      ...(await lessonQuestions("g1-write-sentences")),
      ...(await lessonQuestions("g1-story-seeds")),
      ...(await lessonQuestions("g1-guided-paragraph")),
      ...(await lessonQuestions("g1-fix-sentences")),
    ];
    expect(new Set(cases.map((q) => q.question_type))).toEqual(
      new Set(["SENTENCE_WRITING", "STORY_ORDER_WRITING", "GUIDED_WRITING", "EDIT_AND_CORRECT"]),
    );
    const events: AttemptEvent[] = [];
    cases.forEach((q, i) => {
      events.push(
        attempt(q, correctWritingResponse(q.question_type, q.content, q.answer, null), minutesAgo(60 - i)),
      );
      events.push(attempt(q, wrongWritingResponse(q.question_type, q.content), minutesAgo(40 - i)));
    });
    const result = await processSyncBatch(childId, events);
    expect(result.results.every((r) => r.status === "stored")).toBe(true);
    const { data: rows } = await parent.client
      .from("activity_attempts")
      .select("id, is_correct, writing_analysis, response")
      .in(
        "id",
        events.map((e) => e.id),
      );
    const byId = new Map(rows!.map((r) => [r.id, r]));
    events.forEach((e, i) =>
      expect(
        byId.get(e.id)!.is_correct,
        `${cases[Math.floor(i / 2)].question_type} ${i % 2 ? "wrong" : "right"}`,
      ).toBe(i % 2 === 0),
    );
    // The child's own text is kept as written; the analysis names checks, never answers.
    const free = byId.get(events[0].id)!;
    expect(free.response).toEqual(events[0].response);
    expect(JSON.stringify(free.writing_analysis)).not.toMatch(/umbrella|puddle/);
    expect((free.writing_analysis as { kind: string }).kind).toBe("rubric");
    // Story writing: the order is checked and recorded.
    const storyIndex = cases.findIndex((q) => q.question_type === "STORY_ORDER_WRITING");
    expect(byId.get(events[storyIndex * 2 + 1].id)!.writing_analysis).toMatchObject({
      kind: "story",
      orderOk: false,
    });
    // The device key for the same question holds digests only.
    const key = await buildAnswerKey("SENTENCE_WRITING", cases[0].answer as never, "salt", {
      content: cases[0].content,
      settings,
    });
    expect(JSON.stringify(key)).not.toMatch(/umbrella|puddle|rain\b/);
    // Writing answers build ordinary skill mastery.
    const { data: mastery } = await parent.client
      .from("skill_mastery")
      .select("skill_id, attempts")
      .eq("child_id", childId)
      .in("skill_id", [...new Set(cases.map((q) => q.skill_id))]);
    expect(mastery!.length).toBe(new Set(cases.map((q) => q.skill_id)).size);
  });

  it("keeps writing private to the family, and rubrics and answers server-only", async () => {
    const { data: theirs } = await other.client
      .from("activity_attempts")
      .select("id, writing_analysis")
      .eq("child_id", childId);
    expect(theirs).toEqual([]);
    const { data: reviews } = await other.client
      .from("review_items")
      .select("item_key")
      .eq("child_id", childId);
    expect(reviews).toEqual([]);
    expect((await processSyncBatch(otherChildId, [])).results).toEqual([]);
    const glyphs = await parent.client
      .from("handwriting_glyphs")
      .select("code, strokes")
      .eq("code", "lower-a");
    expect(glyphs.data).toHaveLength(1);
    const rubrics = await parent.client.from("writing_rubrics").select("code");
    expect(rubrics.data ?? []).toEqual([]);
    const answers = await parent.client.from("questions").select("answer").limit(1);
    expect(answers.error).not.toBeNull();
    const correct = await parent.client
      .from("activity_attempts")
      .select("correct_answer")
      .eq("child_id", childId)
      .limit(1);
    expect(correct.error).not.toBeNull();
    const write = await parent.client
      .from("handwriting_glyphs")
      .update({ tolerance: 40 })
      .eq("code", "lower-a")
      .select("code");
    expect(write.data ?? []).toEqual([]);
  });
});
