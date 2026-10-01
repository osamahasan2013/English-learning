import { beforeAll, describe, expect, it } from "vitest";
import { ContentImporter } from "@/lib/content/importer";
import { wordSchema } from "@/lib/content/content-schemas";
import type { AttemptEvent } from "@/lib/offline/sync-protocol";
import { processSyncBatch } from "@/lib/server/progress-writer";
import { levelId, registerParent, serviceClient, type Client } from "./helpers";

// Phase 5 through the real database, auth server and REST API: word answers update word
// mastery, per-area progress, My Words and the review queue; My Words can only be changed
// for the parent's own child; the importer refuses invalid and duplicate words; words are
// found by any level they suit and by the phonics patterns their split uses.

type ChoiceQuestion = { id: string; answer: { accepted: string[] } };

async function choiceQuestionsFor(word: string) {
  const db = serviceClient();
  const { data: w } = await db.from("words").select("id").eq("normalized_word", word).single();
  const { data } = await db
    .from("questions")
    .select("id, answer, activity_id")
    .eq("word_id", w!.id)
    .eq("status", "published")
    .in("question_type", ["MULTIPLE_CHOICE", "LISTEN_AND_CHOOSE", "PICTURE_MATCH"])
    .not("activity_id", "is", null);
  return { wordId: w!.id, questions: (data ?? []) as unknown as ChoiceQuestion[] };
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const answer = (q: ChoiceQuestion, right: boolean, at: string): AttemptEvent => ({
  kind: "attempt",
  id: crypto.randomUUID(),
  questionId: q.id,
  lessonRunId: null,
  sessionId: null,
  attemptNumber: 1,
  response: { value: right ? q.answer.accepted[0] : "definitely-wrong" },
  responseTimeMs: 1500,
  attemptedAt: at,
});

describe("vocabulary engine (real database)", () => {
  let parent: { client: Client; userId: string };
  let other: { client: Client; userId: string };
  let childId: string;
  let sad: Awaited<ReturnType<typeof choiceQuestionsFor>>;

  beforeAll(async () => {
    [parent, other] = await Promise.all([registerParent("Vocab A"), registerParent("Vocab B")]);
    const g1 = await levelId(parent.client, "GRADE1");
    const { data } = await parent.client
      .from("children")
      .insert({ name: "Wren", grade_level_id: g1, current_level_id: g1 })
      .select("id")
      .single();
    childId = data!.id;
    sad = await choiceQuestionsFor("sad");
    expect(sad.questions.length).toBeGreaterThanOrEqual(2);
  });

  const progress = async (wordId: string) => {
    const { data } = await parent.client
      .from("word_progress")
      .select(
        "status, attempts_count, correct_count, accuracy, is_saved, saved_source, first_seen_at, last_reviewed_at",
      )
      .eq("child_id", childId)
      .eq("word_id", wordId)
      .maybeSingle();
    return data;
  };
  const review = async (wordId: string) => {
    const { data } = await parent.client
      .from("review_items")
      .select("reason, status")
      .eq("child_id", childId)
      .eq("word_id", wordId)
      .maybeSingle();
    return data;
  };

  it("never masters a word from one right answer, and saves it to My Words", async () => {
    const [q] = sad.questions;
    const result = await processSyncBatch(childId, [answer(q, true, minutesAgo(30))]);
    expect(result.results[0].status).toBe("stored");
    expect(await progress(sad.wordId)).toMatchObject({
      status: "LEARNING",
      attempts_count: 1,
      is_saved: true,
      saved_source: "auto",
    });
    const p = await progress(sad.wordId);
    expect(p!.first_seen_at).not.toBeNull();
    // Practice outside a lesson run counts as a review.
    expect(p!.last_reviewed_at).not.toBeNull();
    const { data: areas } = await parent.client
      .from("word_area_progress")
      .select("area, attempts_count, correct_count")
      .eq("child_id", childId)
      .eq("word_id", sad.wordId);
    expect(areas!.length).toBe(1);
    expect(areas![0]).toMatchObject({ attempts_count: 1, correct_count: 1 });
  });

  it("brings a missed word back, then keeps a weak word in review", async () => {
    const qs = sad.questions;
    await processSyncBatch(childId, [
      answer(qs[1 % qs.length], false, minutesAgo(20)),
      answer(qs[0], false, minutesAgo(19)),
      answer(qs[1 % qs.length], false, minutesAgo(18)),
    ]);
    expect(await review(sad.wordId)).toMatchObject({ reason: "missed_word", status: "open" });
    // Right again, but 2 of 5 (40%) is still weak.
    await processSyncBatch(childId, [answer(qs[0], true, minutesAgo(10))]);
    expect(await progress(sad.wordId)).toMatchObject({ attempts_count: 5, correct_count: 2, accuracy: 40 });
    expect(await review(sad.wordId)).toMatchObject({ reason: "weak_word", status: "open" });
  });

  it("keeps a word the family removed out of My Words", async () => {
    const { error } = await parent.client.rpc("set_word_saved", {
      p_child_id: childId,
      p_word_id: sad.wordId,
      p_saved: false,
    });
    expect(error).toBeNull();
    await processSyncBatch(childId, [answer(sad.questions[0], true, minutesAgo(5))]);
    expect(await progress(sad.wordId)).toMatchObject({
      is_saved: false,
      saved_source: "manual",
      attempts_count: 6,
    });
  });

  it("only lets parents change My Words for their own children", async () => {
    const { error } = await other.client.rpc("set_word_saved", {
      p_child_id: childId,
      p_word_id: sad.wordId,
      p_saved: true,
    });
    expect(error?.message).toMatch(/CHILD_NOT_FOUND/);
    const { data } = await other.client.from("word_progress").select("word_id").eq("child_id", childId);
    expect(data).toEqual([]);
    const forged = await parent.client
      .from("word_progress")
      .update({ status: "MASTERED" })
      .eq("child_id", childId)
      .select();
    expect(forged.data ?? []).toEqual([]);
  });

  it("finds words by any level they suit and by the patterns their split uses", async () => {
    const kg3 = await levelId(parent.client, "KG3");
    const { data: byLevel } = await parent.client
      .from("words")
      .select("normalized_word, word_levels!inner(level_id)")
      .eq("word_levels.level_id", kg3)
      .eq("normalized_word", "sad");
    expect(byLevel?.map((w) => w.normalized_word)).toEqual(["sad"]); // introduced in Grade 1, also KG3

    const { data: sh } = await parent.client.from("phonics_patterns").select("id").eq("code", "SH").single();
    const { data: shWords } = await parent.client
      .from("words")
      .select("normalized_word, word_segments!inner(pattern_id)")
      .eq("word_segments.pattern_id", sh!.id)
      .limit(500);
    const found = new Set(shWords!.map((w) => w.normalized_word));
    expect(found.has("ship")).toBe(true);
    expect(found.has("fish")).toBe(true);
    expect(found.has("cat")).toBe(false);

    const { data: family } = await parent.client
      .from("word_families")
      .select("code, word_family_members(words(normalized_word))")
      .eq("code", "AT")
      .single();
    const members = family!.word_family_members.map(
      (m) => (Array.isArray(m.words) ? m.words[0] : m.words)?.normalized_word,
    );
    expect(members).toEqual(expect.arrayContaining(["cat", "bat", "hat"]));
    expect(members).not.toContain("boat");
  });

  it("refuses duplicate (any case) and invalid words on import", async () => {
    const importer = new ContentImporter(serviceClient(), { dryRun: true });
    const word = (w: Record<string, unknown>) => wordSchema.parse({ level: "KG1", difficulty: 1, ...w });
    await importer.importWords([
      word({ word: "Zebrafish", category: "ANIMALS" }),
      word({ word: "zebrafish", category: "ANIMALS" }),
      word({ word: "snorkel", category: "NOPE" }),
      word({ word: "tadpole", category: "FOOD", subcategory: "FARM_ANIMALS" }),
      word({ word: "gecko", level: "GRADE9" }),
    ]);
    const report = importer.report.words;
    expect(report.added).toBe(1);
    expect(report.duplicate).toBe(1);
    expect(report.invalid).toBe(3);
    expect(report.errors.join("\n")).toMatch(/unknown category "NOPE"/);
    expect(report.errors.join("\n")).toMatch(/subcategory FARM_ANIMALS is not part of category FOOD/);
  });
});
