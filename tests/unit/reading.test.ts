import { describe, expect, it } from "vitest";
import { parseQuestion } from "@/lib/content/question-schemas";
import {
  comprehensionQuestion,
  readingLessonActivities,
  ReadingContentError,
} from "@/lib/content/reading-content";
import { storySchema } from "@/lib/content/content-schemas";
import { buildAnswerKey, checkWithKey, revealAnswer } from "@/lib/learning/answer-key";
import { evaluateResponse } from "@/lib/learning/evaluate";
import type { ClientQuestion } from "@/lib/learning/lesson-payload";
import {
  analyzeText,
  baseFormCandidates,
  checkTextForLevel,
  comprehensionBySkill,
  deriveReadingWordReview,
  paragraphsOf,
  readingDifficulty,
  recommendReading,
  splitSentences,
  summarizeReadingSessions,
  tokenizeWords,
  type WordClass,
} from "@/lib/learning/reading";
import { DEFAULT_RULES } from "@/lib/learning/rules";
import { readingEventSchema } from "@/lib/offline/sync-protocol";

// The reading engine's pure logic: text splitting and analysis, level fit, difficulty,
// comprehension questions, the reading lesson blueprint, session summaries (never a speed
// or accuracy score), recommendations and help-word review.

const decodable: WordClass = { decodable: true, sight: false, irregular: false, patterns: [] };
const sight: WordClass = { decodable: false, sight: true, irregular: true, patterns: [] };

describe("text", () => {
  it("tokenizes words with apostrophes and hyphens, normalised", () => {
    expect(tokenizeWords("Lee’s ice-cream, don't!").map((t) => t.normalized)).toEqual([
      "lee's",
      "ice-cream",
      "don't",
    ]);
  });

  it("splits sentences but keeps dialogue together", () => {
    expect(splitSentences('"Look!" said Sam. The cat sat.  Then it ran?')).toEqual([
      '"Look!" said Sam.',
      "The cat sat.",
      "Then it ran?",
    ]);
    expect(splitSentences("A fox.")).toEqual(["A fox."]);
    expect(splitSentences("  ")).toEqual([]);
  });

  it("keeps pages as paragraphs with speakers", () => {
    const paragraphs = paragraphsOf([{ text: "Can I come too?", speaker: "Tom" }, { text: "Yes. You can." }]);
    expect(paragraphs[0]).toMatchObject({
      speaker: "Tom",
      sentences: [{ words: ["can", "i", "come", "too"] }],
    });
    expect(paragraphs[1].sentences).toHaveLength(2);
  });

  it("finds base forms of regular inflections only", () => {
    expect(baseFormCandidates("naps")).toContain("nap");
    expect(baseFormCandidates("napped")).toContain("nap");
    expect(baseFormCandidates("liked")).toContain("like");
    expect(baseFormCandidates("babies")).toContain("baby");
    expect(baseFormCandidates("lee's")).toContain("lee");
    // A one-letter "base" is never offered (is → i, as → a).
    expect(baseFormCandidates("is")).toEqual([]);
  });
});

describe("analyzeText", () => {
  const paragraphs = paragraphsOf([{ text: "The cat sat. The cat ran to Zed." }]);
  const bank: Record<string, WordClass> = {
    the: sight,
    cat: { ...decodable, patterns: ["LETTER_A"] },
    sat: decodable,
    ran: decodable,
    to: sight,
  };
  const analysis = analyzeText({
    paragraphs,
    classify: (w) => bank[w] ?? null,
    targetPatterns: ["LETTER_A"],
    focusWords: ["cat"],
  });

  it("counts words, sentences and decodability", () => {
    expect(analysis.stats).toMatchObject({ sentences: 2, words: 8, decodable: 4, sight: 3, unknown: 1 });
    expect(analysis.stats.longestSentence).toBe(5);
    // 7 of 8 running words are decodable or sight words.
    expect(analysis.decodablePct).toBe(87.5);
  });

  it("reports words outside the word bank instead of guessing", () => {
    expect(analysis.unknownWords).toEqual(["zed"]);
  });

  it("flags target-pattern and focus words, once per word with occurrences", () => {
    const cat = analysis.words.find((w) => w.normalized === "cat")!;
    expect(cat).toMatchObject({ occurrences: 2, firstPosition: 1, isTargetPattern: true, isFocus: true });
  });

  it("scores longer, less decodable texts as harder", () => {
    const easy = readingDifficulty(analysis);
    const hard = readingDifficulty({
      decodablePct: 40,
      stats: { ...analysis.stats, words: 200, avgSentenceWords: 12, avgWordLetters: 5 },
    });
    expect(easy).toBeGreaterThanOrEqual(1);
    expect(hard).toBeGreaterThan(easy);
    expect(hard).toBeLessThanOrEqual(10);
  });
});

describe("checkTextForLevel", () => {
  const analysis = analyzeText({
    paragraphs: paragraphsOf([{ text: "The big red dog sat on the mat today." }]),
    classify: () => decodable,
  });
  const base = {
    levelCode: "KG1",
    levelRank: 1,
    analysis,
    contentType: { code: "SENTENCE_READING", minLevelRank: 1 },
    skills: [{ code: "FIND_EXPLICIT_INFORMATION", minLevelRank: 1 }],
    skillCodes: ["FIND_EXPLICIT_INFORMATION"],
    questionCount: 2,
  };

  it("rejects sentences too long for the level", () => {
    expect(checkTextForLevel(base).map((i) => i.rule)).toContain("sentence_too_long");
    expect(
      checkTextForLevel({ ...base, levelCode: "GRADE1", levelRank: 4 }).filter((i) => i.severity === "error"),
    ).toEqual([]);
  });

  it("never allows an advanced reading skill in KG1/KG2", () => {
    const issues = checkTextForLevel({
      ...base,
      levelCode: "KG2",
      levelRank: 2,
      skills: [{ code: "SIMPLE_INFERENCE", minLevelRank: 4 }],
      skillCodes: ["SIMPLE_INFERENCE"],
    });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "error", rule: "skill_too_advanced" }));
  });

  it("rejects unknown skills and content types too advanced for the level", () => {
    const issues = checkTextForLevel({
      ...base,
      levelCode: "GRADE1",
      levelRank: 4,
      contentType: { code: "INFORMATIONAL_TEXT", minLevelRank: 5 },
      skills: [null],
      skillCodes: ["NOPE"],
    });
    expect(issues.map((i) => i.rule)).toEqual(
      expect.arrayContaining(["content_type_too_advanced", "unknown_reading_skill"]),
    );
  });
});

describe("comprehension questions", () => {
  const story = {
    code: "test-story",
    pages: [{ text: "Sam has a red hat. The hat is big." }, { text: "Sam is happy." }],
  };

  it("turns each authored form into a valid ordinary question", () => {
    const forms = [
      {
        type: "CHOICE",
        skill: "FIND_EXPLICIT_INFORMATION",
        prompt: "What colour?",
        options: [
          { id: "red", text: "red" },
          { id: "blue", text: "blue" },
        ],
        answer: "red",
        ref: [0, 0],
      },
      {
        type: "TRUE_FALSE",
        skill: "FIND_EXPLICIT_INFORMATION",
        prompt: "Is the hat big?",
        answer: true,
        ref: [0, 1],
      },
      {
        type: "WORD_MEANING",
        skill: "VOCABULARY_IN_CONTEXT",
        word: "big",
        prompt: "Big means?",
        options: [
          { id: "large", text: "large" },
          { id: "tiny", text: "tiny" },
        ],
        answer: "large",
      },
      {
        type: "SELECT_ALL",
        skill: "SUPPORTING_DETAILS",
        prompt: "True things?",
        options: [
          { id: "a", text: "red hat" },
          { id: "b", text: "big hat" },
          { id: "c", text: "blue hat" },
        ],
        answer: ["a", "b"],
      },
      {
        type: "ORDER",
        skill: "SEQUENCING",
        prompt: "Order",
        events: [{ text: "one" }, { text: "two" }, { text: "three" }],
      },
      {
        type: "MATCH",
        skill: "CHARACTER_IDENTIFICATION",
        prompt: "Match",
        pairs: [
          { left: { text: "Sam" }, right: { text: "happy" } },
          { left: { text: "hat" }, right: { text: "big" } },
        ],
      },
    ] as const;
    forms.forEach((form, i) => {
      const q = comprehensionQuestion(story, structuredClone(form) as never, i, "kg2-skill");
      expect(q.skill).toBe("kg2-skill");
      expect(q.metadata).toEqual({ readingSkill: form.skill });
      expect(q.story).toBe("test-story");
      const parsed = parseQuestion(q.type, q.content, q.answer);
      expect(parsed.ok, `${form.type}: ${!parsed.ok && parsed.error}`).toBe(true);
    });
  });

  it("never stores events in the right order", () => {
    const q = comprehensionQuestion(
      story,
      {
        type: "ORDER",
        skill: "SEQUENCING",
        prompt: "Order",
        explanation: "",
        difficulty: 1,
        promptSpeech: "",
        events: [{ text: "a" }, { text: "b" }, { text: "c" }],
      },
      0,
      undefined,
    );
    const ids = (q.content.events as { id: string }[]).map((e) => e.id);
    expect(ids).not.toEqual(["e1", "e2", "e3"]);
    expect(q.answer).toEqual({ acceptedSequences: [["e1", "e2", "e3"]] });
  });

  it("fails clearly on a reference outside the text or a word not in it", () => {
    const bad = (extra: object) => () =>
      comprehensionQuestion(
        story,
        {
          type: "CHOICE",
          skill: "FIND_EXPLICIT_INFORMATION",
          prompt: "?",
          explanation: "",
          difficulty: 1,
          promptSpeech: "",
          options: [
            { id: "a", text: "a" },
            { id: "b", text: "b" },
          ],
          answer: "a",
          ...extra,
        } as never,
        0,
        undefined,
      );
    expect(bad({ ref: [5, 0] })).toThrow(ReadingContentError);
    expect(bad({ answer: "z" })).toThrow(/not an option/);
    expect(() =>
      comprehensionQuestion(
        story,
        {
          type: "WORD_MEANING",
          skill: "VOCABULARY_IN_CONTEXT",
          word: "elephant",
          prompt: "?",
          explanation: "",
          difficulty: 1,
          promptSpeech: "",
          options: [
            { id: "a", text: "a" },
            { id: "b", text: "b" },
          ],
          answer: "a",
        },
        0,
        undefined,
      ),
    ).toThrow(/not in the text/);
  });
});

describe("the reading lesson blueprint", () => {
  const story = storySchema.parse({
    code: "sam-hat",
    title: "Sam's Hat",
    level: "KG3",
    difficulty: 2,
    summary: "Sam has a hat.",
    coverEmoji: "🎩",
    targetPatterns: ["SH"],
    focusWords: ["hat"],
    practiceWords: ["is"],
    reread: true,
    pages: [{ text: "Sam has a hat. The ship is big." }],
    questions: [
      { type: "TRUE_FALSE", skill: "FIND_EXPLICIT_INFORMATION", prompt: "Is the ship big?", answer: true },
      { type: "TRUE_FALSE", skill: "FIND_EXPLICIT_INFORMATION", prompt: "Is the hat red?", answer: false },
      {
        type: "ORDER",
        skill: "SEQUENCING",
        prompt: "Order",
        events: [{ text: "a" }, { text: "b" }, { text: "c" }],
      },
    ],
  });
  const skills = new Map([
    ["FIND_EXPLICIT_INFORMATION", "kg3-reading-find-it"],
    ["SEQUENCING", "kg3-reading-sequencing"],
  ]);

  it("builds the guided steps the text needs, in order", () => {
    const activities = readingLessonActivities({
      story,
      skills,
      level: DEFAULT_RULES.reading.levels.KG3,
      patternWords: new Map([["SH", "ship"]]),
    });
    expect(activities.map((a) => a.type)).toEqual([
      "INTRO", // get ready
      "INTRO", // words to know
      "FIND_PATTERN", // the phonics pattern
      "READ_PASSAGE", // listen, then read
      "READING", // two questions in one activity
      "ORDER_EVENTS",
      "LISTEN_AND_CHOOSE", // tricky words
      "READ_PASSAGE", // read it again
    ]);
    const read = activities[3];
    expect(read.config).toEqual({ story: "sam-hat" });
    expect(read.questions[0]).toMatchObject({ content: { mode: "listen_first", highlight: "sentence" } });
    expect(activities[4].questions).toHaveLength(2);
    expect(activities[4].questions[0]).toMatchObject({ skill: "kg3-reading-find-it" });
  });

  it("starts by reading at Grade 1 and leaves out steps without content", () => {
    const plain = { ...story, focusWords: [], targetPatterns: [], practiceWords: [], reread: false };
    const activities = readingLessonActivities({
      story: plain,
      skills,
      level: DEFAULT_RULES.reading.levels.GRADE1,
      patternWords: new Map(),
    });
    expect(activities.map((a) => a.type)).toEqual(["INTRO", "READ_PASSAGE", "READING", "ORDER_EVENTS"]);
    expect(activities[1].questions[0]).toMatchObject({ content: { mode: "read_first" } });
  });

  it("fails when the level has no skill for a question's reading skill", () => {
    expect(() =>
      readingLessonActivities({
        story,
        skills: new Map(),
        level: DEFAULT_RULES.reading.levels.KG3,
        patternWords: new Map([["SH", "ship"]]),
      }),
    ).toThrow(/no FIND_EXPLICIT_INFORMATION skill/);
  });
});

describe("new question types: device and server agree", () => {
  const selectAll = {
    type: "SELECT_ALL" as const,
    content: {
      options: [
        { id: "a", text: "a" },
        { id: "b", text: "b" },
        { id: "c", text: "c" },
        { id: "d", text: "d" },
      ],
    },
    answer: { correct: ["a", "c"] },
  };
  const order = {
    type: "ORDER_EVENTS" as const,
    content: {
      events: [
        { id: "e2", text: "two" },
        { id: "e1", text: "one" },
        { id: "e3", text: "three" },
      ],
    },
    answer: { acceptedSequences: [["e1", "e2", "e3"]] },
  };

  it("select-all needs exactly the right set, in any order", async () => {
    const parsed = parseQuestion(selectAll.type, selectAll.content, selectAll.answer);
    expect(parsed.ok).toBe(true);
    const key = await buildAnswerKey("SELECT_ALL", selectAll.answer, "salt");
    expect(JSON.stringify(key)).not.toContain('"a"');
    for (const [sequence, isCorrect, almost] of [
      [["c", "a"], true, false],
      [["a"], false, true],
      [["a", "c", "d"], false, false],
      [["b"], false, false],
    ] as const) {
      const server = evaluateResponse("SELECT_ALL", selectAll.answer, { sequence: [...sequence] });
      const device = await checkWithKey("SELECT_ALL", key, { sequence: [...sequence] });
      expect(server.isCorrect, sequence.join()).toBe(isCorrect);
      expect(device).toEqual({ isCorrect: server.isCorrect, almost: server.almost });
      expect(server.almost).toBe(almost);
    }
    expect(evaluateResponse("SELECT_ALL", selectAll.answer, { sequence: ["a"] }).errorType).toBe(
      "missed_choice",
    );
    const reveal = await revealAnswer(
      { type: "SELECT_ALL", content: parsed.ok ? parsed.question.content : null } as ClientQuestion,
      key,
    );
    expect(reveal?.sequence).toEqual(["a", "c"]);
  });

  it("select-all content must have a wrong option and real option ids", () => {
    expect(parseQuestion("SELECT_ALL", selectAll.content, { correct: ["a", "z"] }).ok).toBe(false);
    expect(
      parseQuestion(
        "SELECT_ALL",
        { options: selectAll.content.options.slice(0, 3) },
        { correct: ["a", "b", "c"] },
      ).ok,
    ).toBe(false);
  });

  it("ordering events: the order counts, near misses are almost", async () => {
    const parsed = parseQuestion(order.type, order.content, order.answer);
    expect(parsed.ok).toBe(true);
    const key = await buildAnswerKey("ORDER_EVENTS", order.answer, "salt");
    for (const sequence of [
      ["e1", "e2", "e3"],
      ["e1", "e3", "e2"],
      ["e3", "e2", "e1"],
    ]) {
      const server = evaluateResponse("ORDER_EVENTS", order.answer, { sequence });
      const device = await checkWithKey("ORDER_EVENTS", key, { sequence });
      expect(device).toEqual({ isCorrect: server.isCorrect, almost: server.almost });
    }
    expect(evaluateResponse("ORDER_EVENTS", order.answer, { sequence: ["e2", "e1", "e3"] }).errorType).toBe(
      "wrong_order",
    );
    const reveal = await revealAnswer(
      { type: "ORDER_EVENTS", content: order.content } as ClientQuestion,
      key,
    );
    expect(reveal?.sequence).toEqual(["e1", "e2", "e3"]);
  });

  it("refuses events stored already in order, and true/false needs two options", () => {
    expect(
      parseQuestion(
        "ORDER_EVENTS",
        {
          events: [
            { id: "e1", text: "a" },
            { id: "e2", text: "b" },
            { id: "e3", text: "c" },
          ],
        },
        order.answer,
      ).ok,
    ).toBe(false);
    expect(
      parseQuestion(
        "READING",
        {
          format: "true_false",
          options: [
            { id: "yes", text: "Yes" },
            { id: "no", text: "No" },
            { id: "x", text: "?" },
          ],
        },
        { accepted: ["yes"] },
      ).ok,
    ).toBe(false);
  });

  it("reading a text is unscored (no answer, no key)", async () => {
    const parsed = parseQuestion("READ_PASSAGE", { mode: "listen_first" }, null);
    expect(parsed.ok && parsed.question.answer).toBeNull();
    expect(await buildAnswerKey("READ_PASSAGE", null, "salt")).toEqual({ mode: "none" });
  });
});

describe("reading sessions", () => {
  const session = (over: Partial<Parameters<typeof summarizeReadingSessions>[0][number]> = {}) => ({
    storyId: "s1",
    startedAt: "2026-10-01T10:00:00Z",
    durationMs: 60_000,
    wordCount: 40,
    listens: 1,
    slowListens: 0,
    rereads: 0,
    helpWordIds: [],
    selfCheck: null,
    ...over,
  });

  it("totals time (capped), re-reads, listens and help words — never a speed", () => {
    const summary = summarizeReadingSessions([
      session({ helpWordIds: ["w1", "w2"], selfCheck: "easy" }),
      session({
        storyId: "s2",
        durationMs: 3_600_000,
        rereads: 2,
        helpWordIds: ["w1", "w1"],
        startedAt: "2026-10-02T10:00:00Z",
      }),
    ]);
    expect(summary).toMatchObject({ readings: 2, texts: 2, rereads: 2, listens: 2, wordsRead: 80 });
    // The hour-long open screen counts only up to the cap.
    expect(summary.totalSeconds).toBe(60 + DEFAULT_RULES.reading.maxCountedSeconds);
    expect(summary.helpWords).toEqual([
      { wordId: "w1", taps: 2 },
      { wordId: "w2", taps: 1 },
    ]);
    expect(summary.lastReadAt).toBe("2026-10-02T10:00:00Z");
    expect(Object.keys(summary).join()).not.toMatch(/wpm|speed|accuracy/i);
  });

  it("accepts a well-formed reading event and nothing that claims a score", () => {
    const event = {
      kind: "reading",
      id: "7d8c2f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
      storyId: "7d8c2f4e-1a2b-4c3d-8e9f-0a1b2c3d4e50",
      lessonId: null,
      lessonRunId: null,
      questionId: null,
      mode: "read_first",
      startedAt: "2026-10-01T10:00:00Z",
      durationMs: 1000,
      listens: 0,
      slowListens: 0,
      rereads: 0,
      helpWordIds: [],
      selfCheck: null,
    };
    expect(readingEventSchema.safeParse(event).success).toBe(true);
    expect(readingEventSchema.safeParse({ ...event, durationMs: -1 }).success).toBe(false);
    expect(readingEventSchema.safeParse({ ...event, helpWordIds: ["not-a-uuid"] }).success).toBe(false);
    expect(readingEventSchema.safeParse({ ...event, mode: "fast" }).success).toBe(false);
  });
});

describe("comprehension, recommendations and review", () => {
  it("summarises first tries per reading skill", () => {
    expect(
      comprehensionBySkill([
        { readingSkillCode: "SEQUENCING", storyId: "s", isCorrect: true },
        { readingSkillCode: "SEQUENCING", storyId: "s", isCorrect: false },
        { readingSkillCode: null, storyId: "s", isCorrect: true },
      ]),
    ).toEqual([{ code: "SEQUENCING", firstTries: 2, correct: 1, percent: 50 }]);
  });

  it("suggests re-reads for hard texts, then unread texts, then a stretch", () => {
    const texts = [
      { id: "a", levelRank: 2, readingLevel: 4, difficulty: 2, lessonId: "la" },
      { id: "b", levelRank: 2, readingLevel: 5, difficulty: 2, lessonId: "lb" },
      { id: "c", levelRank: 3, readingLevel: 7, difficulty: 3, lessonId: "lc" },
      { id: "x", levelRank: 2, readingLevel: 1, difficulty: 1, lessonId: null },
    ];
    expect(
      recommendReading({
        texts,
        levelRank: 2,
        readStoryIds: new Set(["a"]),
        comprehension: new Map([["a", { percent: 40 }]]),
      }),
    ).toEqual([
      { storyId: "a", reason: "reread" },
      { storyId: "b", reason: "next" },
    ]);
    expect(
      recommendReading({ texts, levelRank: 2, readStoryIds: new Set(["a", "b"]), comprehension: new Map() }),
    ).toEqual([{ storyId: "c", reason: "stretch" }]);
  });

  it("puts a word up for review only after repeated help, until it is read or answered", () => {
    const now = new Date("2026-10-03T10:00:00Z");
    const tap = (day: number, tapped: boolean) => ({ startedAt: `2026-10-0${day}T09:00:00Z`, tapped });
    const base = { wordId: "w", lessonId: null, lastCorrectAt: null };
    expect(deriveReadingWordReview({ ...base, readings: [tap(1, true)] }, now)).toBeNull();
    const item = deriveReadingWordReview({ ...base, readings: [tap(1, true), tap(2, true)] }, now);
    expect(item).toMatchObject({
      item_key: "reading:w",
      word_id: "w",
      reason: "reading_word",
      status: "open",
    });
    // Read without help since: resolved.
    expect(
      deriveReadingWordReview({ ...base, readings: [tap(1, true), tap(2, true), tap(3, false)] }, now),
    ).toBeNull();
    // Answered right after the last tap: resolved.
    expect(
      deriveReadingWordReview(
        { ...base, readings: [tap(1, true), tap(2, true)], lastCorrectAt: "2026-10-02T12:00:00Z" },
        now,
      ),
    ).toBeNull();
  });
});
