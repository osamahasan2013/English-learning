import { beforeAll, describe, expect, it } from "vitest";
import { ContentImporter } from "@/lib/content/importer";
import { spellingWordSchema } from "@/lib/content/content-schemas";
import { syncEventSchema, type AttemptEvent } from "@/lib/offline/sync-protocol";
import { processSyncBatch } from "@/lib/server/progress-writer";
import { levelId, registerParent, serviceClient, type Client } from "./helpers";

// Phase 6 through the real database, auth server and REST API: a spelling answer is
// re-checked on the server against the stored answer (never one sent by the device), stored
// with its analysis (category, pattern, normalised text; the child's text kept as typed),
// feeds spelling mastery (separate from vocabulary), the spelling review item and the
// phonics-pattern review item; another family sees none of it; the spelling import reports
// created / skipped / invalid / duplicate rows.

type SpellingQuestion = { id: string; answer: { accepted: string[]; requirePunctuation?: boolean } };

async function spellingQuestion(word: string, activity: string) {
  const db = serviceClient();
  const { data: w } = await db.from("words").select("id").eq("normalized_word", word).single();
  const { data } = await db
    .from("questions")
    .select("id, answer")
    .eq("word_id", w!.id)
    .eq("status", "published")
    .eq("metadata->>spellingActivity", activity)
    .limit(1)
    .single();
  return { wordId: w!.id as string, question: data as unknown as SpellingQuestion };
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const typed = (q: SpellingQuestion, value: string, at: string, hintsUsed = 0): AttemptEvent => ({
  kind: "attempt",
  id: crypto.randomUUID(),
  questionId: q.id,
  lessonRunId: null,
  sessionId: null,
  attemptNumber: 1,
  response: { value },
  responseTimeMs: 2500,
  hintsUsed,
  attemptedAt: at,
});

describe("spelling engine (real database)", () => {
  let parent: { client: Client; userId: string };
  let other: { client: Client; userId: string };
  let childId: string;
  let ship: Awaited<ReturnType<typeof spellingQuestion>>;
  let fish: Awaited<ReturnType<typeof spellingQuestion>>;
  let shPatternId: string;

  beforeAll(async () => {
    [parent, other] = await Promise.all([registerParent("Spell A"), registerParent("Spell B")]);
    const kg3 = await levelId(parent.client, "KG3");
    const { data } = await parent.client
      .from("children")
      .insert({ name: "Ivy", grade_level_id: kg3, current_level_id: kg3 })
      .select("id")
      .single();
    childId = data!.id;
    ship = await spellingQuestion("ship", "LISTEN_AND_TYPE");
    fish = await spellingQuestion("fish", "LISTEN_AND_TYPE");
    const { data: sh } = await serviceClient()
      .from("phonics_patterns")
      .select("id")
      .eq("code", "SH")
      .single();
    shPatternId = sh!.id;
  });

  const attemptsFor = async (client: Client, wordId: string) => {
    const { data } = await client
      .from("activity_attempts")
      .select("response, is_correct, error_type, hints_used, spelling_analysis, error_pattern_id")
      .eq("child_id", childId)
      .eq("word_id", wordId)
      .order("attempted_at");
    return data ?? [];
  };
  const openItem = async (key: string) => {
    const { data } = await parent.client
      .from("review_items")
      .select("reason, status, lesson_id")
      .eq("child_id", childId)
      .eq("item_key", key)
      .maybeSingle();
    return data;
  };

  it("re-checks the answer on the server and stores the analysis, ignoring any verdict from the device", async () => {
    // A modified device may add its own answer and verdict: the protocol drops them.
    const forged = syncEventSchema.parse({
      ...typed(ship.question, "sip", minutesAgo(30)),
      correctAnswer: "sip",
      isCorrect: true,
    });
    expect(forged).not.toHaveProperty("correctAnswer");
    expect(forged).not.toHaveProperty("isCorrect");
    const result = await processSyncBatch(childId, [forged]);
    expect(result.results[0].status).toBe("stored");

    const [row] = await attemptsFor(parent.client, ship.wordId);
    expect(row).toMatchObject({
      response: { value: "sip" },
      is_correct: false,
      error_type: "WRONG_DIGRAPH",
      error_pattern_id: shPatternId,
    });
    expect(row.spelling_analysis).toMatchObject({
      normalized: "sip",
      correct: false,
      category: "WRONG_DIGRAPH",
      patternCode: "SH",
    });
    // The stored answer snapshot stays hidden from families.
    const { error } = await parent.client
      .from("activity_attempts")
      .select("correct_answer")
      .eq("child_id", childId);
    expect(error).not.toBeNull();
  });

  it("keeps the child's text as typed and accepts case and spacing differences", async () => {
    await processSyncBatch(childId, [typed(fish.question, "  Fish ", minutesAgo(29))]);
    const [row] = await attemptsFor(parent.client, fish.wordId);
    expect(row).toMatchObject({ response: { value: "  Fish " }, is_correct: true, error_type: null });
    expect(row.spelling_analysis).toMatchObject({ normalized: "fish", correct: true, exact: false });
  });

  it("updates spelling mastery apart from vocabulary and queues the missed word once", async () => {
    const { data: progress } = await parent.client
      .from("spelling_progress")
      .select("attempts_count, correct_count, status, last_error_type, error_counts")
      .eq("child_id", childId)
      .eq("word_id", ship.wordId)
      .single();
    expect(progress).toMatchObject({
      attempts_count: 1,
      correct_count: 0,
      status: "LEARNING",
      last_error_type: "WRONG_DIGRAPH",
      error_counts: { WRONG_DIGRAPH: 1 },
    });
    expect(await openItem(`spelling:${ship.wordId}`)).toMatchObject({
      reason: "missed_spelling",
      status: "open",
    });
    // The vocabulary queue does not count the same miss again.
    const word = await openItem(`word:${ship.wordId}`);
    expect(word === null || !["missed_word", "weak_word"].includes(word.reason)).toBe(true);
  });

  it("counts a hinted answer as right but not as independent spelling", async () => {
    await processSyncBatch(childId, [typed(ship.question, "ship", minutesAgo(25), 2)]);
    const { data } = await parent.client
      .from("spelling_progress")
      .select("attempts_count, correct_count, hinted_count")
      .eq("child_id", childId)
      .eq("word_id", ship.wordId)
      .single();
    expect(data).toMatchObject({ attempts_count: 2, correct_count: 0, hinted_count: 1 });
    const rows = await attemptsFor(parent.client, ship.wordId);
    expect(rows.at(-1)).toMatchObject({ is_correct: true, hints_used: 2 });
  });

  it("reviews a phonics pattern misspelled twice, at its phonics lesson, until it is spelled right", async () => {
    await processSyncBatch(childId, [typed(fish.question, "fis", minutesAgo(20))]);
    const item = await openItem(`pattern:${shPatternId}`);
    expect(item).toMatchObject({ reason: "spelling_pattern", status: "open" });
    const { data: lesson } = await serviceClient()
      .from("lessons")
      .select("code")
      .eq("id", item!.lesson_id!)
      .single();
    expect(lesson!.code).toMatch(/sh/);

    const dish = await spellingQuestion("dish", "LISTEN_AND_TYPE");
    const shop = await spellingQuestion("shop", "LISTEN_AND_TYPE");
    await processSyncBatch(childId, [
      typed(dish.question, "dish", minutesAgo(10)),
      typed(shop.question, "shop", minutesAgo(9)),
    ]);
    expect(await openItem(`pattern:${shPatternId}`)).toMatchObject({ status: "done" });
  });

  it("checks sentence dictation word by word and for capitals and full stops where required", async () => {
    const db = serviceClient();
    const { data: questions } = await db
      .from("questions")
      .select("id, answer")
      .eq("question_type", "SENTENCE_DICTATION")
      .eq("status", "published");
    const strict = (questions as unknown as SpellingQuestion[]).find((q) => q.answer.requirePunctuation)!;
    expect(strict).toBeDefined();
    const sentence = strict.answer.accepted[0];
    const event = (value: string, at: string): AttemptEvent => ({
      ...typed(strict, value, at),
      questionId: strict.id,
    });
    await processSyncBatch(childId, [
      event(sentence.toLowerCase().replace(/[.!?]$/, ""), minutesAgo(5)),
      event(sentence, minutesAgo(4)),
    ]);
    const { data } = await parent.client
      .from("activity_attempts")
      .select("is_correct, error_type, spelling_analysis")
      .eq("child_id", childId)
      .eq("question_id", strict.id)
      .order("attempted_at");
    expect(data![0]).toMatchObject({ is_correct: false, error_type: "PUNCTUATION" });
    expect(data![0].spelling_analysis).toMatchObject({ kind: "sentence", wordsCorrect: true });
    expect(data![1]).toMatchObject({ is_correct: true, error_type: null });
  });

  it("never lets a family write spelling progress, answer for another child, or read the answer", async () => {
    // The sync route looks the child up with the signed-in parent's own client: another
    // parent gets nothing back, so the route answers 403 and writes nothing.
    const { data: foreign } = await other.client
      .from("children")
      .select("id")
      .eq("id", childId)
      .maybeSingle();
    expect(foreign).toBeNull();
    // Attempts, scores and mastery are written only by the server: not by another family,
    // and not by the child's own parent either (no self-made "correct" attempts).
    const { data: shipRow } = await serviceClient()
      .from("questions")
      .select("skill_id")
      .eq("id", ship.question.id)
      .single();
    // A complete, valid row: only the policies stop it.
    const forgedAttempt = {
      id: crypto.randomUUID(),
      child_id: childId,
      question_id: ship.question.id,
      skill_id: shipRow!.skill_id,
      word_id: ship.wordId,
      question_type: "SPELLING",
      attempt_number: 1,
      response: { value: "ship" },
      response_time_ms: 2000,
      attempted_at: new Date().toISOString(),
      is_correct: true,
      score: 100,
    };
    for (const client of [other.client, parent.client]) {
      const insert = await client.from("activity_attempts").insert(forgedAttempt);
      expect(insert.error).not.toBeNull();
      const progress = await client
        .from("spelling_progress")
        .upsert({ child_id: childId, word_id: ship.wordId, status: "MASTERED", mastery_score: 100 });
      expect(progress.error).not.toBeNull();
    }
    // The stored answer of a spelling question is not readable by families.
    const answer = await parent.client.from("questions").select("answer").eq("id", ship.question.id);
    expect(answer.error).not.toBeNull();
    const { data: progress } = await serviceClient()
      .from("spelling_progress")
      .select("status")
      .eq("child_id", childId)
      .eq("word_id", ship.wordId)
      .maybeSingle();
    expect(progress?.status).not.toBe("MASTERED");
  });

  it("analyses a missing-letter answer as the whole word, and keeps segmenting out of spelling mastery", async () => {
    const db = serviceClient();
    const byCode = async (code: string) => {
      const { data } = await db.from("questions").select("id, word_id").eq("code", code).single();
      return { id: data!.id, word_id: data!.word_id! };
    };
    const missing = await byCode("kg2-spell-cvc-1-a4-q1"); // b_g → big
    const segment = await byCode("kg2-spell-cvc-1-a2-q1"); // WORD_TO_SOUNDS: bag
    const event = (questionId: string, response: AttemptEvent["response"], at: string): AttemptEvent => ({
      ...typed({ id: questionId, answer: { accepted: [] } }, "", at),
      response,
    });
    const result = await processSyncBatch(childId, [
      event(missing.id, { value: "a" }, minutesAgo(12)),
      event(segment.id, { sequence: ["b", "ae", "g"] }, minutesAgo(11)),
    ]);
    expect(result.results.map((r) => r.status)).toEqual(["stored", "stored"]);
    // MISSING_LETTER: the child's letter in the word (bag for big) is what gets analysed.
    const [bigAttempt] = await attemptsFor(parent.client, missing.word_id);
    expect(bigAttempt).toMatchObject({
      response: { value: "a" },
      is_correct: false,
      error_type: "WRONG_VOWEL",
    });
    expect(bigAttempt.spelling_analysis).toMatchObject({ normalized: "bag", category: "WRONG_VOWEL" });
    const { data: bigProgress } = await parent.client
      .from("spelling_progress")
      .select("attempts_count, correct_count")
      .eq("child_id", childId)
      .eq("word_id", missing.word_id)
      .single();
    expect(bigProgress).toMatchObject({ attempts_count: 1, correct_count: 0 });
    // WORD_TO_SOUNDS (segmenting) is stored and scored, but it is phonics evidence, not
    // spelling: it does not create spelling mastery for "bag".
    const [bagAttempt] = await attemptsFor(parent.client, segment.word_id);
    expect(bagAttempt).toMatchObject({ is_correct: true, spelling_analysis: null });
    const { data: bagProgress } = await parent.client
      .from("spelling_progress")
      .select("word_id")
      .eq("child_id", childId)
      .eq("word_id", segment.word_id)
      .maybeSingle();
    expect(bagProgress).toBeNull();
  });

  it("shows another family nothing", async () => {
    const [progress, attempts, errors, items] = await Promise.all([
      other.client.from("spelling_progress").select("word_id").eq("child_id", childId),
      other.client.from("activity_attempts").select("id").eq("child_id", childId),
      other.client.from("spelling_error_counts").select("error_type").eq("child_id", childId),
      other.client.from("review_items").select("id").eq("child_id", childId),
    ]);
    expect(progress.data).toEqual([]);
    expect(attempts.data).toEqual([]);
    expect(errors.data).toEqual([]);
    expect(items.data).toEqual([]);
    // And the owning parent's analytics view sees their child's mistakes.
    const { data: own } = await parent.client
      .from("spelling_error_counts")
      .select("error_type, attempts")
      .eq("child_id", childId);
    expect(own!.map((e) => e.error_type)).toContain("WRONG_DIGRAPH");
  });

  it("imports spelling targets with a created / skipped / invalid / duplicate report", async () => {
    const importer = new ContentImporter(serviceClient(), { dryRun: true });
    const row = (word: string, extra: Record<string, unknown> = {}) =>
      spellingWordSchema.parse({ word, level: "KG3", spellingType: "DIGRAPH", difficulty: 2, ...extra });
    const report = await importer.importBundle({
      spelling: [
        row("ship", { skill: "kg3-spell-digraphs", phonicsPattern: "SH" }),
        row("ship"),
        row("notaword"),
        row("chip", { spellingType: "NO_SUCH_TYPE" }),
        row("said", { isIrregular: true, irregularPart: "zz" }),
      ],
    });
    const spelling = report["spelling words"];
    expect(spelling.duplicate).toBe(1);
    expect(spelling.invalid).toBe(3);
    expect(spelling.added + spelling.updated + spelling.skipped).toBe(1);
    expect(spelling.errors.join("\n")).toMatch(/notaword.*word bank/);
  });
});
