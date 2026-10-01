import { describe, expect, it } from "vitest";
import { parseWordsCsv, WORD_CSV_REQUIRED_COLUMNS } from "@/lib/content/csv";
import { expandBlueprint } from "@/lib/content/lesson-blueprints";
import { publicImageUrl, sniffImage, validateImageUpload } from "@/lib/content/media";
import { parseQuestion } from "@/lib/content/question-schemas";
import { expandTemplate, type TemplateContext, type TemplateWord } from "@/lib/content/templates";
import {
  distractorPlan,
  editDistance,
  exampleSentenceIssues,
  familyMembers,
  findWordInSentence,
  pickContrastGroup,
  pickDistractors,
  swapWord,
} from "@/lib/content/vocabulary";
import { DEFAULT_RULES } from "@/lib/learning/rules";
import {
  autoSaveDecision,
  computeWordProgress,
  deriveWordReview,
  pickPracticeQuestions,
  summarizeVocabulary,
  wordAreaFor,
  wordStars,
  type VocabularyWordFact,
} from "@/lib/learning/vocabulary";
import { parseWordSearch, wordSearchQuery } from "@/lib/validation/vocabulary";

const w = (word: string, extra: Partial<TemplateWord> = {}): TemplateWord => ({
  word,
  emoji: "",
  childDefinition: `About ${word}.`,
  patterns: [],
  levelRank: 1,
  partOfSpeech: "noun",
  difficulty: 1,
  published: true,
  ...extra,
});

const bank: TemplateWord[] = [
  w("cat", {
    emoji: "🐱",
    topCategory: "ANIMALS",
    topCategoryName: "Animals",
    examples: ["The cat is sleeping."],
  }),
  w("dog", { emoji: "🐶", topCategory: "ANIMALS", topCategoryName: "Animals" }),
  w("pig", { emoji: "🐷", topCategory: "ANIMALS", topCategoryName: "Animals" }),
  w("puppy", { emoji: "🐶", topCategory: "ANIMALS", topCategoryName: "Animals", synonyms: ["dog"] }),
  w("hound", { emoji: "🐕", topCategory: "ANIMALS", synonyms: ["dog"] }),
  w("milk", {
    emoji: "🥛",
    topCategory: "FOOD",
    topCategoryName: "Food",
    childDefinition: "Something you drink.",
  }),
  w("apple", { emoji: "🍎", topCategory: "FOOD", topCategoryName: "Food" }),
  w("cake", { emoji: "🎂", topCategory: "FOOD", topCategoryName: "Food" }),
  w("chair", { emoji: "🪑", topCategory: "HOME", topCategoryName: "Home" }),
  w("cap", { emoji: "🧢", topCategory: "CLOTHING", topCategoryName: "Clothes" }),
  w("cut", { emoji: "✂️", topCategory: "ACTIONS", partOfSpeech: "verb" }),
  w("car", { emoji: "🚗", topCategory: "TRANSPORTATION" }),
  w("happy", {
    emoji: "😊",
    topCategory: "FEELINGS",
    topCategoryName: "Feelings",
    partOfSpeech: "adjective",
    examples: ["The girl is happy."],
  }),
  w("table", { emoji: "🍽️", topCategory: "HOME", levelRank: 1 }),
  w("rhinoceros", { emoji: "🦏", topCategory: "ANIMALS", levelRank: 5 }),
  w("the", { topCategory: "FUNCTION_WORDS", partOfSpeech: "determiner" }),
];

const ctx = (seed: string, levelRank = 1): TemplateContext => ({
  seed,
  levelRank,
  words: () => bank,
  word: (t) => bank.find((x) => x.word === t),
  pattern: () => undefined,
});

describe("word areas and progress", () => {
  it("takes a question's tagged area, else its type", () => {
    expect(wordAreaFor("MULTIPLE_CHOICE", { wordArea: "meaning" })).toBe("meaning");
    expect(wordAreaFor("LISTEN_AND_CHOOSE", {})).toBe("listening");
    expect(wordAreaFor("SPELLING", null)).toBe("spelling");
    expect(wordAreaFor("DRAG_DROP", { wordArea: "nonsense" })).toBe("usage");
    expect(wordAreaFor("TRACING", {})).toBeNull();
  });

  const day = (d: number, h = 10) => new Date(Date.UTC(2026, 9, d, h)).toISOString();

  it("never masters a word from one right answer", () => {
    const p = computeWordProgress([{ isCorrect: true, attemptedAt: day(1), area: "listening" }], {
      now: new Date(day(1, 12)),
    });
    expect(p.status).toBe("LEARNING");
    expect(p.masteryScore).toBeLessThan(40);
    expect(p.areas).toEqual([
      { area: "listening", attempts: 1, correct: 1, accuracy: 100, lastPracticedAt: day(1) },
    ]);
  });

  it("needs practice on two days to master a word", () => {
    const sameDay = Array.from({ length: 6 }, (_, i) => ({
      isCorrect: true,
      attemptedAt: day(1, 8 + i),
      area: "recognition" as const,
    }));
    expect(computeWordProgress(sameDay, { now: new Date(day(1, 20)) }).status).toBe("ALMOST_MASTERED");
    const twoDays = [
      ...sameDay.slice(0, 3),
      ...sameDay.slice(3).map((a, i) => ({ ...a, attemptedAt: day(2, 8 + i) })),
    ];
    const p = computeWordProgress(twoDays, { now: new Date(day(2, 20)) });
    expect(p.status).toBe("MASTERED");
    expect(p.practiceDays).toBe(2);
    expect(p.accuracy).toBe(100);
  });

  it("splits performance by area", () => {
    const p = computeWordProgress(
      [
        { isCorrect: true, attemptedAt: day(1), area: "spelling" },
        { isCorrect: false, attemptedAt: day(2), area: "spelling" },
        { isCorrect: true, attemptedAt: day(2), area: "meaning" },
        { isCorrect: true, attemptedAt: day(2), area: null },
      ],
      { now: new Date(day(3)) },
    );
    expect(p.attempts).toBe(4);
    expect(p.areas.map((a) => [a.area, a.attempts, a.accuracy])).toEqual([
      ["meaning", 1, 100],
      ["spelling", 2, 50],
    ]);
  });

  it("saves a word to My Words once it is answered right, unless the family decided", () => {
    expect(autoSaveDecision(null, 1)).toEqual({ isSaved: true, savedSource: "auto" });
    expect(autoSaveDecision(null, 0)).toEqual({ isSaved: false, savedSource: null });
    expect(autoSaveDecision({ isSaved: false, savedSource: "manual" }, 5)).toEqual({
      isSaved: false,
      savedSource: "manual",
    });
    expect(autoSaveDecision({ isSaved: false, savedSource: null }, 1)).toEqual({
      isSaved: true,
      savedSource: "auto",
    });
  });

  it("puts missed, weak and saved words in the review queue", () => {
    const now = new Date(day(10));
    const base = { wordId: "w1", skillId: "s1", lessonId: null, saved: false };
    const progress = { attempts: 2, accuracy: 50, reviewPriority: 60, nextReviewAt: day(11) };
    const missed = deriveWordReview(
      { ...base, attempts: [{ isCorrect: false, attemptedAt: day(9) }], progress },
      now,
    );
    expect(missed).toMatchObject({ reason: "missed_word", item_key: "word:w1", due_at: now.toISOString() });

    // "beautiful" at 42%: weak even though the latest answer was right.
    const weak = deriveWordReview(
      {
        ...base,
        attempts: [
          { isCorrect: false, attemptedAt: day(1) },
          { isCorrect: true, attemptedAt: day(9) },
        ],
        progress: { attempts: 12, accuracy: 42, reviewPriority: 30, nextReviewAt: day(11) },
      },
      now,
    );
    expect(weak).toMatchObject({ reason: "weak_word", priority: 50 });

    const fine = { attempts: 6, accuracy: 100, reviewPriority: 20, nextReviewAt: day(14) };
    const right = [{ isCorrect: true, attemptedAt: day(9) }];
    expect(deriveWordReview({ ...base, attempts: right, progress: fine }, now)).toBeNull();
    expect(deriveWordReview({ ...base, saved: true, attempts: right, progress: fine }, now)).toMatchObject({
      reason: "due_review",
      due_at: day(14),
    });
    expect(deriveWordReview({ ...base, attempts: [], progress: fine }, now)).toBeNull();
  });

  it("summarises vocabulary for parents without noise", () => {
    const fact = (word: string, extra: Partial<VocabularyWordFact>): VocabularyWordFact => ({
      wordId: word,
      word,
      emoji: "",
      categoryCode: "ANIMALS",
      categoryName: "Animals",
      status: "LEARNING",
      attempts: 0,
      correct: 0,
      accuracy: 0,
      isSaved: false,
      lastPracticedAt: null,
      ...extra,
    });
    const summary = summarizeVocabulary(
      [
        fact("cat", {
          status: "MASTERED",
          attempts: 8,
          correct: 8,
          accuracy: 100,
          lastPracticedAt: "2026-10-02",
        }),
        fact("dog", { attempts: 5, correct: 2, accuracy: 40, isSaved: true, lastPracticedAt: "2026-10-03" }),
        fact("milk", { categoryCode: "FOOD", categoryName: "Food", attempts: 1, correct: 1, accuracy: 100 }),
        fact("pig", { status: "NOT_STARTED", isSaved: true }),
      ],
      [
        { area: "spelling", attempts: 6, correct: 2 },
        { area: "listening", attempts: 8, correct: 8 },
        { area: "meaning", attempts: 1, correct: 0 },
      ],
    );
    expect(summary).toMatchObject({
      wordsSeen: 4,
      wordsPracticed: 3,
      wordsLearned: 2,
      wordsMastered: 1,
      savedWords: 2,
    });
    expect(summary.areas.find((a) => a.area === "spelling")).toMatchObject({ weak: true, accuracy: 33.33 });
    // One meaning answer is not enough to call it weak.
    expect(summary.areas.find((a) => a.area === "meaning")?.weak).toBe(false);
    expect(summary.categories.map((c) => c.code)).toEqual(["ANIMALS", "FOOD"]);
    expect(summary.weakWords.map((x) => x.word)).toEqual(["dog"]);
    expect(summary.recent.map((x) => x.word)).toEqual(["dog", "cat"]);
    expect(wordStars("MASTERED")).toBe(3);
  });

  it("picks varied practice questions, most urgent words first", () => {
    const qs = [
      { id: "1", wordId: "a", area: "spelling" as const },
      { id: "2", wordId: "a", area: "spelling" as const },
      { id: "3", wordId: "a", area: "listening" as const },
      { id: "4", wordId: "b", area: "meaning" as const },
      { id: "5", wordId: null, area: null },
    ];
    expect(pickPracticeQuestions(qs, ["a", "b"], 3).map((q) => q.id)).toEqual(["1", "4", "3"]);
    expect(pickPracticeQuestions(qs, ["b"], 5).map((q) => q.id)).toEqual(["4"]);
  });
});

describe("distractors", () => {
  it("never offers the word, its synonyms, a shared picture or words above the level", () => {
    const dog = bank.find((x) => x.word === "dog")!;
    for (const seed of ["a", "b", "c", "d"]) {
      const picked = pickDistractors(dog, bank, {
        count: 3,
        strategy: "category",
        need: ["emoji"],
        levelRank: 1,
        seed,
      });
      const words = picked.map((x) => x.word);
      expect(words).not.toContain("dog");
      expect(words).not.toContain("puppy");
      expect(words).not.toContain("hound");
      expect(words).not.toContain("rhinoceros");
      expect(words).not.toContain("the");
    }
  });

  it("chooses other categories for young children and the same category later", () => {
    const cat = bank[0];
    const easy = pickDistractors(cat, bank, { count: 2, strategy: "contrast", levelRank: 1, seed: "x" });
    expect(easy.every((x) => x.topCategory !== "ANIMALS")).toBe(true);
    const hard = pickDistractors(cat, bank, { count: 2, strategy: "category", levelRank: 1, seed: "x" });
    expect(hard.every((x) => x.topCategory === "ANIMALS")).toBe(true);
    expect(distractorPlan(1)).toEqual({ count: 2, strategy: "contrast" });
    expect(distractorPlan(5)).toEqual({ count: 3, strategy: "category" });
  });

  it("finds look-alike words and is deterministic", () => {
    const cat = bank[0];
    const similar = pickDistractors(cat, bank, { count: 3, strategy: "similar", levelRank: 1, seed: "s" });
    expect(similar.map((x) => x.word).sort()).toEqual(["cap", "car", "cut"]);
    expect(pickDistractors(cat, bank, { count: 2, strategy: "contrast", seed: "same" })).toEqual(
      pickDistractors(cat, bank, { count: 2, strategy: "contrast", seed: "same" }),
    );
    expect(editDistance("cat", "cut")).toBe(1);
  });

  it("refuses rather than using unsuitable words", () => {
    expect(() => pickDistractors(bank[0], bank, { count: 20, strategy: "contrast", seed: "x" })).toThrow(
      /not enough suitable distractors/,
    );
  });

  it("picks a sorting group from one other category", () => {
    const group = pickContrastGroup(bank[0], bank, { count: 2, levelRank: 1, seed: "g" });
    expect(new Set(group.map((x) => x.topCategory)).size).toBe(1);
    expect(group[0].topCategory).not.toBe("ANIMALS");
  });
});

describe("sentences and families", () => {
  it("finds the word or one of its forms as a whole word", () => {
    expect(findWordInSentence("The cat is sleeping.", "cat")).toMatchObject({ before: "The ", match: "cat" });
    expect(findWordInSentence("I like cats.", "cat", ["cats"])).toMatchObject({
      match: "cats",
      form: "cats",
    });
    expect(findWordInSentence("A catalog.", "cat")).toBeNull();
    expect(swapWord("Happy dogs run.", "happy", "table")).toBe("Table dogs run.");
  });

  it("checks curated example sentences", () => {
    expect(exampleSentenceIssues("The cat is sleeping.", "cat", [], 6)).toEqual([]);
    expect(exampleSentenceIssues("the cat sleeps", "dog", [], 2)).toEqual([
      "should start with a capital letter",
      "should end with . ! or ?",
      'does not use "dog"',
      "has 3 words (the level allows 2)",
    ]);
  });

  it("derives rime families from grapheme splits, not just letters", () => {
    const seg = (pairs: [string, string[]][]) =>
      pairs.map(([grapheme, phonemes]) => ({ grapheme, phonemes }));
    const words = [
      {
        word: "cat",
        syllables: 1,
        segments: seg([
          ["c", ["K"]],
          ["a", ["AE"]],
          ["t", ["T"]],
        ]),
      },
      {
        word: "that",
        syllables: 1,
        segments: seg([
          ["th", ["DH"]],
          ["a", ["AE"]],
          ["t", ["T"]],
        ]),
      },
      {
        word: "what",
        syllables: 1,
        segments: seg([
          ["wh", ["W"]],
          ["a", ["AH"]],
          ["t", ["T"]],
        ]),
      },
      {
        word: "boat",
        syllables: 1,
        segments: seg([
          ["b", ["B"]],
          ["oa", ["OW"]],
          ["t", ["T"]],
        ]),
      },
      {
        word: "at",
        syllables: 1,
        segments: seg([
          ["a", ["AE"]],
          ["t", ["T"]],
        ]),
      },
    ];
    expect(familyMembers("at", ["AE"], words)).toEqual(["cat", "that"]);
  });
});

describe("vocabulary templates and blueprint", () => {
  const valid = (name: string, params: Record<string, unknown>, rank = 1) => {
    const q = expandTemplate(name, params, ctx(`${name}-q1`, rank));
    const parsed = parseQuestion(q.type, q.content, q.answer);
    expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
    return q;
  };

  it("asks for a word from its child-friendly meaning", () => {
    const q = valid("meaning_to_word", { word: "milk" });
    expect(q.content.display).toBe("Something you drink.");
    expect(q.area).toBe("meaning");
    const options = (q.content.options as { id: string }[]).map((o) => o.id);
    expect(options).toContain("milk");
    expect(options).not.toContain("apple");
  });

  it("builds usage questions from the example sentence", () => {
    const complete = valid("complete_sentence", { word: "cat" }, 4);
    expect(complete).toMatchObject({ type: "DRAG_DROP", sentence: "The cat is sleeping.", area: "usage" });
    const use = valid("use_in_sentence", { word: "happy" }, 4);
    const texts = (use.content.options as { text: string }[]).map((o) => o.text);
    expect(texts).toContain("The girl is happy.");
    expect(texts.length).toBe(3);
    expect(use.answer).toEqual({ accepted: ["right"] });
  });

  it("sorts, finds the odd one out and matches pictures", () => {
    valid("sort_by_category", { words: ["cat", "dog", "pig"] });
    const odd = valid("odd_one_out", { words: ["cat", "dog", "pig"] });
    expect(odd.answer?.accepted).not.toContain("cat");
    valid("match_word_picture", { words: ["cat", "milk", "chair"] });
    expect(() => expandTemplate("match_word_picture", { words: ["dog", "puppy"] }, ctx("x"))).toThrow(
      /share a picture/,
    );
  });

  it("grows the vocabulary lesson with the level", () => {
    const words = ["cat", "dog", "pig", "puppy", "hound", "milk"];
    const types = (rank: number) =>
      expandBlueprint({ name: "vocabulary_set", words, levelRank: rank }).map((a) => a.type);
    expect(types(1)).toEqual(["INTRO", "LISTEN_AND_CHOOSE", "MULTIPLE_CHOICE", "MULTIPLE_CHOICE"]);
    expect(types(3)).toContain("SPELLING");
    expect(types(3)).not.toContain("SORT");
    expect(types(5)).toContain("SORT");
    expect(
      expandBlueprint({ name: "vocabulary_set", words, levelRank: 5, mixed: true }).map((a) => a.type),
    ).not.toContain("SORT");
    expect(() => expandBlueprint({ name: "vocabulary_set", words: ["cat"] })).toThrow();
  });
});

describe("vocabulary import format", () => {
  const header = [
    ...WORD_CSV_REQUIRED_COLUMNS,
    "levels",
    "subcategory",
    "examples",
    "synonyms",
    "inflections",
  ].join(",");
  it("reads levels, sub-categories, examples, synonyms and inflections", () => {
    const { rows } = parseWordsCsv(
      `${header}\nrun,KG2,ACTIONS,1,,To move fast.,I run.,no,KG3;GRADE1,,We run home.|They run fast.,sprint,past=ran;ing=running\n`,
    );
    expect(rows[0]).toMatchObject({
      ok: true,
      word: {
        levels: ["KG3", "GRADE1"],
        examples: ["We run home.", "They run fast."],
        synonyms: ["sprint"],
        inflections: { past: "ran", ing: "running" },
      },
    });
  });

  it("rejects malformed rows instead of importing them", () => {
    const { rows } = parseWordsCsv(
      `${header}\nice cream,KG1,FOOD,1,,Cold.,Yum.,no,,,,,\nrun,KG2,ACTIONS,1,,Go.,I run.,no,,,,,colour=red\n`,
    );
    expect(rows.map((r) => r.ok)).toEqual([false, false]);
  });
});

describe("uploaded images", () => {
  const png = (w: number, h: number) => {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return b;
  };
  const jpeg = (w: number, h: number) =>
    new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0,
      4,
      0,
      0,
      0xff,
      0xc0,
      0,
      11,
      8,
      h >> 8,
      h & 255,
      w >> 8,
      w & 255,
      3,
      0,
      0,
      0,
    ]);
  const webp = (w: number, h: number) => {
    const b = new Uint8Array(30);
    b.set([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8X")]);
    b.set([(w - 1) & 255, ((w - 1) >> 8) & 255, 0, (h - 1) & 255, ((h - 1) >> 8) & 255, 0], 24);
    return b;
  };

  it("reads the real type and size from the file", () => {
    expect(sniffImage(png(512, 256))).toEqual({ mimeType: "image/png", width: 512, height: 256 });
    expect(sniffImage(jpeg(640, 480))).toEqual({ mimeType: "image/jpeg", width: 640, height: 480 });
    expect(sniffImage(webp(300, 200))).toEqual({ mimeType: "image/webp", width: 300, height: 200 });
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("GIF89a........"))).toBeNull();
  });

  it("accepts a described picture and refuses everything else", () => {
    expect(
      validateImageUpload({ bytes: png(512, 512), declaredType: "image/png", altText: " A  cat " }),
    ).toMatchObject({
      ok: true,
      altText: "A cat",
      extension: "png",
    });
    const bad = (input: Parameters<typeof validateImageUpload>[0]) => validateImageUpload(input).ok;
    expect(bad({ bytes: png(512, 512), altText: "" })).toBe(false);
    expect(bad({ bytes: png(512, 512), declaredType: "image/jpeg", altText: "A cat" })).toBe(false);
    expect(bad({ bytes: png(10, 10), altText: "A cat" })).toBe(false);
    expect(bad({ bytes: png(9000, 512), altText: "A cat" })).toBe(false);
    expect(bad({ bytes: new Uint8Array(1024 * 1024 + 1), altText: "A cat" })).toBe(false);
    expect(publicImageUrl("https://x.supabase.co/", "words/cat 1.png")).toBe(
      "https://x.supabase.co/storage/v1/object/public/content-images/words/cat%201.png",
    );
  });
});

describe("vocabulary search filters", () => {
  it("keeps valid filters and drops the rest", () => {
    expect(
      parseWordSearch({
        q: " Ca%t_ ",
        category: "animals",
        level: "KG1",
        pos: "noun",
        shape: "cvc",
        difficulty: "3",
        page: "2",
      }),
    ).toEqual({
      q: "cat",
      category: "ANIMALS",
      level: "KG1",
      pos: "noun",
      shape: "CVC",
      difficulty: 3,
      page: 2,
    });
    expect(
      parseWordSearch({ q: "%%", pos: "thing", difficulty: "99", page: "-4", pattern: "drop table" }),
    ).toEqual({
      page: 1,
    });
    expect(parseWordSearch({})).toEqual({ page: 1 });
    expect(wordSearchQuery({ q: "cat", page: 1 }, { page: 3 })).toBe("q=cat&page=3");
  });
});

it("keeps the vocabulary rules valid", () => {
  expect(DEFAULT_RULES.vocabulary.fullEvidenceAttempts).toBeGreaterThan(1);
});
