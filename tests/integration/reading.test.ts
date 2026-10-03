import { beforeAll, describe, expect, it } from "vitest";
import { ContentImporter } from "@/lib/content/importer";
import { storySchema } from "@/lib/content/content-schemas";
import { syncEventSchema, type AttemptEvent, type ReadingEvent } from "@/lib/offline/sync-protocol";
import { processSyncBatch } from "@/lib/server/progress-writer";
import { anonClient, levelId, registerParent, serviceClient, type Client } from "./helpers";

// Phase 7 through the real database, auth server and REST API: a reading session is stored
// once, with the word count taken from the story and only the story's own words kept as help
// words; repeated help taps make a reading review item that a later unaided reading
// resolves; comprehension answers are ordinary attempts re-checked on the server that build
// ordinary skill mastery; families see only published texts and only their own children's
// reading; nobody but the server writes reading history; the story import fails clearly on
// duplicates, level-inappropriate skills and broken references.

const STORY = "sam-and-the-shell";
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

describe("reading engine (real database)", () => {
  let parent: { client: Client; userId: string };
  let other: { client: Client; userId: string };
  let childId: string;
  let storyId: string;
  let storyWords: number;
  let shellId: string;
  let foreignWordId: string;
  let lessonId: string;
  let readQuestionId: string;

  beforeAll(async () => {
    [parent, other] = await Promise.all([registerParent("Read A"), registerParent("Read B")]);
    const kg3 = await levelId(parent.client, "KG3");
    const { data } = await parent.client
      .from("children")
      .insert({ name: "Rosa", grade_level_id: kg3, current_level_id: kg3 })
      .select("id")
      .single();
    childId = data!.id;
    const db = serviceClient();
    const { data: story } = await db.from("stories").select("id, word_count").eq("code", STORY).single();
    storyId = story!.id;
    storyWords = story!.word_count;
    const { data: words } = await db
      .from("words")
      .select("id, normalized_word")
      .in("normalized_word", ["shell", "zebra"]);
    shellId = words!.find((w) => w.normalized_word === "shell")!.id;
    foreignWordId = words!.find((w) => w.normalized_word === "zebra")!.id;
    const { data: lesson } = await db.from("lessons").select("id").eq("code", `kg3-read-${STORY}`).single();
    lessonId = lesson!.id;
    const { data: q } = await db.from("questions").select("id").eq("code", `${STORY}-read`).single();
    readQuestionId = q!.id;
  });

  const reading = (over: Partial<ReadingEvent> = {}): ReadingEvent => ({
    kind: "reading",
    id: crypto.randomUUID(),
    storyId,
    lessonId,
    lessonRunId: crypto.randomUUID(),
    questionId: readQuestionId,
    sessionId: null,
    mode: "listen_first",
    startedAt: minutesAgo(30),
    durationMs: 45_000,
    listens: 1,
    slowListens: 1,
    rereads: 0,
    helpWordIds: [],
    selfCheck: "ok",
    ...over,
  });

  it("stores a reading session once, never trusting the device's word list or count", async () => {
    const event = reading({ helpWordIds: [shellId, foreignWordId], startedAt: minutesAgo(40) });
    expect(syncEventSchema.safeParse(event).success).toBe(true);
    const first = await processSyncBatch(childId, [event]);
    expect(first.results).toEqual([{ id: event.id, status: "stored" }]);
    const again = await processSyncBatch(childId, [event]);
    expect(again.results).toEqual([{ id: event.id, status: "duplicate" }]);

    const { data } = await parent.client
      .from("reading_sessions")
      .select("story_id, lesson_id, question_id, word_count, help_word_ids, mode, self_check")
      .eq("id", event.id)
      .single();
    expect(data).toMatchObject({
      story_id: storyId,
      lesson_id: lessonId,
      question_id: readQuestionId,
      word_count: storyWords,
      mode: "listen_first",
      self_check: "ok",
    });
    // "zebra" is not a word of this story: dropped.
    expect(data!.help_word_ids).toEqual([shellId]);
  });

  it("drops a lesson or question the device names that is not a published reading step", async () => {
    const { data: q } = await serviceClient()
      .from("questions")
      .select("id")
      .eq("code", `${STORY}-q1`)
      .single();
    const event = reading({ questionId: q!.id, lessonId: crypto.randomUUID() });
    expect((await processSyncBatch(childId, [event])).results[0].status).toBe("stored");
    const { data } = await parent.client
      .from("reading_sessions")
      .select("lesson_id, lesson_run_id, question_id")
      .eq("id", event.id)
      .single();
    expect(data).toEqual({ lesson_id: null, lesson_run_id: null, question_id: null });
  });

  it("rejects a reading of a story that is not published", async () => {
    const db = serviceClient();
    const { data: s } = await db.from("stories").select("id").eq("code", "the-moth").single();
    await db.from("stories").update({ status: "draft" }).eq("id", s!.id);
    try {
      const event = reading({ storyId: s!.id, lessonId: null, lessonRunId: null, questionId: null });
      expect((await processSyncBatch(childId, [event])).results[0]).toEqual({
        id: event.id,
        status: "rejected",
        reason: "unknown_story",
      });
      // Families no longer see the draft text or its word links.
      expect((await parent.client.from("stories").select("id").eq("id", s!.id)).data).toEqual([]);
      expect((await parent.client.from("story_words").select("word_id").eq("story_id", s!.id)).data).toEqual(
        [],
      );
    } finally {
      await db.from("stories").update({ status: "published" }).eq("id", s!.id);
    }
  });

  it("puts a word up for review after repeated help taps, and resolves it after an unaided reading", async () => {
    const key = `reading:${shellId}`;
    // The first test's session tapped "shell" once; one more tap makes it a review item.
    await processSyncBatch(childId, [reading({ helpWordIds: [shellId], startedAt: minutesAgo(20) })]);
    const open = await parent.client
      .from("review_items")
      .select("reason, status, word_id")
      .eq("child_id", childId)
      .eq("item_key", key)
      .single();
    expect(open.data).toEqual({ reason: "reading_word", status: "open", word_id: shellId });

    await processSyncBatch(childId, [reading({ helpWordIds: [], startedAt: minutesAgo(5), mode: "reread" })]);
    const after = await parent.client
      .from("review_items")
      .select("status")
      .eq("child_id", childId)
      .eq("item_key", key)
      .single();
    expect(after.data!.status).toBe("done");
  });

  it("checks comprehension answers on the server and builds ordinary skill mastery", async () => {
    const db = serviceClient();
    const { data: q } = await db
      .from("questions")
      .select("id, answer, skill_id, skills(code, reading_skill_code)")
      .eq("code", `${STORY}-q3`)
      .single();
    expect(q!.skills).toMatchObject({ reading_skill_code: "SEQUENCING" });
    const right = (q!.answer as { acceptedSequences: string[][] }).acceptedSequences[0];
    const attempt = (sequence: string[], at: string): AttemptEvent => ({
      kind: "attempt",
      id: crypto.randomUUID(),
      questionId: q!.id,
      lessonRunId: null,
      sessionId: null,
      attemptNumber: 1,
      response: { sequence },
      responseTimeMs: 4000,
      attemptedAt: at,
    });
    const events = [attempt([...right].reverse(), minutesAgo(4)), attempt(right, minutesAgo(3))];
    const result = await processSyncBatch(childId, events);
    expect(result.results.map((r) => r.status)).toEqual(["stored", "stored"]);
    const { data: attempts } = await parent.client
      .from("activity_attempts")
      .select("is_correct, error_type")
      .eq("child_id", childId)
      .eq("question_id", q!.id)
      .order("attempted_at");
    expect(attempts).toEqual([
      { is_correct: false, error_type: "wrong_order" },
      { is_correct: true, error_type: null },
    ]);
    const { data: mastery } = await parent.client
      .from("skill_mastery")
      .select("status")
      .eq("child_id", childId)
      .eq("skill_id", q!.skill_id)
      .single();
    expect(mastery!.status).not.toBe("NOT_STARTED");
  });

  it("another family sees none of it, and nobody but the server writes reading history", async () => {
    expect((await other.client.from("reading_sessions").select("id").eq("child_id", childId)).data).toEqual(
      [],
    );
    expect(
      (await parent.client.from("reading_sessions").select("id").eq("child_id", childId)).data!.length,
    ).toBeGreaterThan(0);
    const forged = await parent.client.from("reading_sessions").insert({
      id: crypto.randomUUID(),
      child_id: childId,
      story_id: storyId,
      mode: "read_first",
      started_at: new Date().toISOString(),
      duration_ms: 1000,
      word_count: 1,
    });
    expect(forged.error).not.toBeNull();
    // A parent cannot rewrite a text or its links (admins only).
    await parent.client.from("stories").update({ title: "Hacked" }).eq("id", storyId);
    const { data: story } = await serviceClient().from("stories").select("title").eq("id", storyId).single();
    expect(story!.title).not.toBe("Hacked");
    const link = await parent.client
      .from("story_words")
      .insert({ story_id: storyId, word_id: foreignWordId });
    expect(link.error).not.toBeNull();
    // Signed out: nothing.
    const anon = anonClient();
    expect((await anon.from("stories").select("id")).data ?? []).toEqual([]);
    expect((await anon.from("reading_sessions").select("id")).data ?? []).toEqual([]);
  });

  it("the story import fails clearly on duplicates, advanced skills and broken references", async () => {
    const importer = new ContentImporter(serviceClient(), { dryRun: true });
    const story = (code: string, extra: Record<string, unknown> = {}) =>
      storySchema.parse({
        code,
        title: "Test text",
        level: "KG2",
        difficulty: 2,
        pages: [{ text: "The cat is big." }],
        questions: [
          { type: "TRUE_FALSE", skill: "FIND_EXPLICIT_INFORMATION", prompt: "Is the cat big?", answer: true },
        ],
        ...extra,
      });
    const report = await importer.importBundle({
      stories: {
        stories: [
          story("test-ok", {
            questions: [
              {
                type: "TRUE_FALSE",
                skill: "FIND_EXPLICIT_INFORMATION",
                prompt: "Is the cat big?",
                answer: true,
              },
              {
                type: "TRUE_FALSE",
                skill: "FIND_EXPLICIT_INFORMATION",
                prompt: "Is the cat small?",
                answer: false,
              },
            ],
          }),
          story("test-dup"),
          story("test-inference", {
            title: "Inference in KG2",
            questions: [{ type: "TRUE_FALSE", skill: "SIMPLE_INFERENCE", prompt: "Why?", answer: true }],
          }),
          story("test-pattern", { title: "Bad pattern", targetPatterns: ["NO_SUCH_PATTERN"] }),
          story("test-focus", { title: "Bad focus", focusWords: ["elephant"] }),
          story("test-long", {
            title: "Too long",
            pages: [{ text: "The big cat sat on the red mat in the sun." }],
          }),
        ],
      },
    });
    const stories = report.stories;
    expect(stories.duplicate).toBe(1);
    expect(stories.invalid).toBe(5);
    const errors = stories.errors.join("\n");
    expect(errors).toMatch(/test-dup: another KG2 text is already called "Test text"/);
    expect(errors).toMatch(/test-inference: SIMPLE_INFERENCE is not taught at KG2/);
    expect(errors).toMatch(/test-pattern: unknown phonics pattern "NO_SUCH_PATTERN"/);
    expect(errors).toMatch(/test-focus: "elephant" is not in the text/);
    expect(errors).toMatch(/test-long: a sentence has 11 words/);
  });
});
