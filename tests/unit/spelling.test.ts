import { describe, expect, it } from "vitest";
import { evaluateResponse } from "@/lib/learning/evaluate";
import { buildAnswerKey, checkWithKey } from "@/lib/learning/answer-key";
import { DEFAULT_RULES, mergeLearningRules } from "@/lib/learning/rules";
import {
  analyzeAnswer,
  analyzeSentence,
  analyzeSpelling,
  buildSpellingHints,
  computeSpellingProgress,
  derivePatternReview,
  deriveSpellingReview,
  diffCells,
  diffLetters,
  fallbackSplit,
  normalizeSpelling,
  resolveSpellingSettings,
  segmentKinds,
  soundKey,
  spellingTrend,
  summarizeSpelling,
  type SpellingSegment,
} from "@/lib/learning/spelling";

// Grapheme splits as the importer stores them (word_segments), with pattern types.
const seg = (
  grapheme: string,
  phonemes: string[],
  patternCode: string,
  patternType: string,
): SpellingSegment => ({
  grapheme,
  phonemes,
  patternCode,
  patternType,
});
const L = (g: string, p: string) => seg(g, [p], `LETTER_${g.toUpperCase()}`, "letter");
const SPLITS: Record<string, SpellingSegment[]> = {
  ship: [seg("sh", ["SH"], "SH", "consonant_digraph"), L("i", "IH"), L("p", "P")],
  chip: [seg("ch", ["CH"], "CH", "consonant_digraph"), L("i", "IH"), L("p", "P")],
  cat: [L("c", "K"), L("a", "AE"), L("t", "T")],
  stop: [seg("st", ["S", "T"], "ST", "consonant_blend"), L("o", "AA"), L("p", "P")],
  frog: [seg("fr", ["F", "R"], "FR", "consonant_blend"), L("o", "AA"), L("g", "G")],
  jump: [L("j", "JH"), L("u", "AH"), L("m", "M"), L("p", "P")],
  rain: [L("r", "R"), seg("ai", ["EY"], "AI", "vowel_team"), L("n", "N")],
  cake: [L("c", "K"), seg("a", ["EY"], "A_E", "silent_e"), L("k", "K"), seg("e", [], "A_E", "silent_e")],
  jumped: [L("j", "JH"), L("u", "AH"), L("m", "M"), L("p", "P"), seg("ed", ["T"], "ED", "word_ending")],
  dishes: [
    L("d", "D"),
    L("i", "IH"),
    seg("sh", ["SH"], "SH", "consonant_digraph"),
    seg("es", ["IH", "Z"], "ES", "word_ending"),
  ],
  said: [L("s", "S"), seg("ai", ["EY"], "AI", "vowel_team"), L("d", "D")],
  was: [L("w", "W"), L("a", "AE"), L("s", "S")],
  bird: [L("b", "B"), seg("ir", ["ER"], "IR", "r_controlled"), L("d", "D")],
  phone: [
    seg("ph", ["F"], "PH", "consonant_digraph"),
    seg("o", ["OW"], "O_E", "silent_e"),
    L("n", "N"),
    seg("e", [], "O_E", "silent_e"),
  ],
  bell: [L("b", "B"), L("e", "EH"), seg("ll", ["L"], "LETTER_L", "letter")],
};
const check = (word: string, actual: string, irregularPositions?: number[]) =>
  analyzeSpelling({ expected: [word], actual, split: SPLITS[word], irregularPositions });

describe("normalizeSpelling", () => {
  it("trims, lower-cases and collapses spaces, and nothing else", () => {
    expect(normalizeSpelling("  Ship  ")).toBe("ship");
    expect(normalizeSpelling("ice   cream")).toBe("ice cream");
    expect(normalizeSpelling("don’t")).toBe("don't");
    // No autocorrect: a wrong spelling stays wrong.
    expect(normalizeSpelling("sheep")).toBe("sheep");
    expect(normalizeSpelling("teh")).toBe("teh");
  });
});

describe("analyzeSpelling", () => {
  it("accepts case and spacing differences but reports they were not exact", () => {
    const a = check("ship", " Ship ");
    expect(a.correct).toBe(true);
    expect(a.exact).toBe(false);
    expect(a.category).toBeNull();
    expect(check("ship", "ship").exact).toBe(true);
  });

  it("accepts any listed spelling", () => {
    expect(analyzeSpelling({ expected: ["grey", "gray"], actual: "gray" }).correct).toBe(true);
  });

  it.each([
    ["ship", "sip", "WRONG_DIGRAPH", "SH"],
    ["ship", "chip", "WRONG_DIGRAPH", "SH"],
    ["chip", "ship", "WRONG_DIGRAPH", "CH"],
    ["cat", "cot", "WRONG_VOWEL", "LETTER_A"],
    ["rain", "ran", "WRONG_VOWEL", "AI"],
    ["cake", "cak", "WRONG_VOWEL", "A_E"],
    ["stop", "sop", "WRONG_BLEND", "ST"],
    ["frog", "fog", "WRONG_BLEND", "FR"],
    ["jump", "jup", "WRONG_BLEND", "LETTER_M"],
    ["jumped", "jumpt", "WRONG_ENDING", "ED"],
    ["dishes", "dishs", "WRONG_ENDING", "ES"],
  ])("%s → %s is %s in %s", (word, actual, category, pattern) => {
    const a = check(word, actual);
    expect(a.correct).toBe(false);
    expect(a.category).toBe(category);
    expect(a.patternCode).toBe(pattern);
  });

  it.each([
    ["cat", "kat"],
    ["phone", "fone"],
    ["rain", "rane"],
    ["bird", "burd"],
  ])("%s → %s is a phonetic approximation", (word, actual) => {
    expect(check(word, actual).category).toBe("PHONETIC_APPROXIMATION");
    expect(check(word, actual).patternCode).toBeNull();
  });

  it("names a mistake in the irregular part as spelling it like it sounds", () => {
    expect(check("said", "sed", [1]).category).toBe("PHONETIC_APPROXIMATION");
    expect(check("was", "wuz", [1, 2]).category).toBe("PHONETIC_APPROXIMATION");
    // Outside the irregular part it is an ordinary mistake.
    expect(check("said", "sai", [1]).category).toBe("MISSING_LETTER");
  });

  it("classifies letter-level slips", () => {
    expect(check("ship", "shpi").category).toBe("TRANSPOSITION");
    expect(check("bell", "bel").category).toBe("MISSING_LETTER");
    expect(check("ship", "shipp").category).toBe("EXTRA_LETTER");
    expect(check("cat", "ca").category).toBe("MISSING_LETTER");
    expect(check("cat", "cap").category).toBe("SUBSTITUTED_LETTER");
    expect(check("cat", "cats").category).toBe("EXTRA_LETTER");
  });

  it("calls a far-off or empty answer UNKNOWN", () => {
    expect(check("ship", "dog").category).toBe("UNKNOWN");
    expect(check("cat", "").category).toBe("UNKNOWN");
  });

  it("is deterministic and works without an authored split", () => {
    const a = analyzeSpelling({ expected: ["fish"], actual: "fis" });
    expect(a.category).toBe("WRONG_DIGRAPH");
    expect(analyzeSpelling({ expected: ["fish"], actual: "fis" })).toEqual(a);
    // A split that does not spell the word is ignored, not trusted.
    expect(analyzeSpelling({ expected: ["fish"], actual: "fis", split: SPLITS.ship }).category).toBe(
      "WRONG_DIGRAPH",
    );
  });

  it("marks near misses", () => {
    expect(check("ship", "sip").almost).toBe(true);
    expect(check("ship", "shpi").almost).toBe(true);
    expect(check("ship", "dog").almost).toBe(false);
  });

  it("keeps a letter diff that the child can be shown without colour alone", () => {
    expect(diffCells(diffLetters("ship", "sip"))).toEqual([
      { text: "s", mark: "ok" },
      { text: "_", mark: "missing" },
      { text: "i", mark: "ok" },
      { text: "p", mark: "ok" },
    ]);
    const doubled = diffCells(diffLetters("cat", "catt"));
    expect(doubled.map((c) => c.text).join("")).toBe("catt");
    expect(doubled.filter((c) => c.mark === "extra")).toHaveLength(1);
  });
});

describe("grapheme kinds and fallback split", () => {
  it("finds digraphs, vowel teams and endings without a stored split", () => {
    expect(fallbackSplit("ship").map((s) => s.grapheme)).toEqual(["sh", "i", "p"]);
    expect(fallbackSplit("rain").map((s) => s.grapheme)).toEqual(["r", "ai", "n"]);
    expect(fallbackSplit("jumping").map((s) => s.grapheme)).toEqual(["j", "u", "m", "p", "ing"]);
  });
  it("treats neighbouring consonants as a blend", () => {
    expect(segmentKinds(SPLITS.jump)).toEqual(["consonant", "vowel", "blend", "blend"]);
    expect(segmentKinds(SPLITS.cat)).toEqual(["consonant", "vowel", "consonant"]);
  });
  it("gives sound-alike spellings the same key", () => {
    expect(soundKey("boat")).toBe(soundKey("bote"));
    expect(soundKey("cat")).toBe(soundKey("kat"));
    expect(soundKey("ship")).not.toBe(soundKey("sip"));
  });
});

describe("analyzeSentence (sentence dictation)", () => {
  it("accepts the words in order, case and punctuation aside, unless punctuation is required", () => {
    expect(analyzeSentence({ expected: "The cat sat.", actual: "the cat sat" }).correct).toBe(true);
    const strict = analyzeSentence({
      expected: "The cat sat.",
      actual: "the cat sat",
      requirePunctuation: true,
    });
    expect(strict.correct).toBe(false);
    expect(strict.wordsCorrect).toBe(true);
    expect(strict.category).toBe("PUNCTUATION");
    expect(
      analyzeSentence({ expected: "The cat sat.", actual: "The cat sat.", requirePunctuation: true }).correct,
    ).toBe(true);
  });
  it("finds word order, missing and extra words and misspellings", () => {
    expect(analyzeSentence({ expected: "The cat sat.", actual: "cat the sat" }).category).toBe("WORD_ORDER");
    expect(
      analyzeSentence({ expected: "The cat sat on the mat.", actual: "The cat sat the mat." }).category,
    ).toBe("MISSING_WORD");
    expect(analyzeSentence({ expected: "The cat sat.", actual: "The big cat sat." }).category).toBe(
      "EXTRA_WORD",
    );
    const spelled = analyzeSentence({
      expected: "The fish is in the dish.",
      actual: "The fis is in the dish.",
    });
    expect(spelled.category).toBe("WRONG_DIGRAPH");
    expect(spelled.words.find((w) => w.status === "misspelled")).toMatchObject({
      expected: "fish",
      actual: "fis",
    });
  });
});

describe("evaluation and answer keys for spelling", () => {
  it("evaluates sentence dictation the same way on the server and on the device", async () => {
    const answer = { accepted: ["The cat sat."], requirePunctuation: true };
    for (const value of ["The cat sat.", "the cat sat.", "The cat sat", "The cat sit."]) {
      const server = evaluateResponse("SENTENCE_DICTATION", answer, { value });
      const key = await buildAnswerKey("SENTENCE_DICTATION", answer, "salt");
      const device = await checkWithKey("SENTENCE_DICTATION", key, { value });
      expect(device.isCorrect).toBe(server.isCorrect);
    }
    expect(evaluateResponse("SENTENCE_DICTATION", answer, { value: "The cat sat" }).errorType).toBe(
      "PUNCTUATION",
    );
  });

  it("names spelling mistakes with the spelling categories", () => {
    expect(evaluateResponse("SPELLING", { accepted: ["ship"] }, { value: "sip" }).errorType).toBe(
      "WRONG_DIGRAPH",
    );
    expect(
      evaluateResponse("WORD_BUILDER", { accepted: ["cat"] }, { sequence: ["c", "o", "t"] }).errorType,
    ).toBe("WRONG_VOWEL");
  });

  it("analyses a missing-letter answer as the word it makes", () => {
    const a = analyzeAnswer(
      {
        type: "MISSING_LETTER",
        content: { word: "ship", parts: [{ blank: true }, { text: "ip" }], split: SPLITS.ship },
      },
      { value: "ch" },
    );
    expect(a?.category).toBe("WRONG_DIGRAPH");
    expect(analyzeAnswer({ type: "MULTIPLE_CHOICE", content: {} }, { value: "x" })).toBeNull();
  });
});

describe("hints", () => {
  it("go from least to most help (listen, slowly, how many sounds, the pattern) and respect the limit", () => {
    const hints = buildSpellingHints({ word: "ship", split: SPLITS.ship, focusPattern: "SH" });
    expect(hints.map((h) => h.kind)).toEqual(["listen", "listen_slow", "sounds", "pattern"]);
    expect(hints[2]).toMatchObject({ text: "How many sounds do you hear? 3.", show: "● ● ●" });
    expect(hints[3].show).toBe("sh _ _");
    expect(buildSpellingHints({ word: "ship", split: SPLITS.ship, max: 1 })).toHaveLength(1);
    expect(buildSpellingHints({ word: "ship", max: 0 })).toHaveLength(0);
  });
  it("show the first letter last for a regular word, and never the whole word", () => {
    const hints = buildSpellingHints({ word: "cat", split: SPLITS.cat });
    expect(hints.at(-1)).toMatchObject({ kind: "first_sound", show: "c _ _" });
    expect(hints.some((h) => h.show === "c a t")).toBe(false);
  });
  it("point at the tricky part of an irregular word", () => {
    const hints = buildSpellingHints({ word: "said", split: SPLITS.said, irregularPositions: [1] });
    expect(hints.at(-1)).toMatchObject({ kind: "tricky", show: "_ ai _" });
  });
  it("put authored hints before the last, most helpful one", () => {
    const hints = buildSpellingHints({ word: "cat", authored: [{ text: "A pet that says meow." }] });
    expect(hints.map((h) => h.kind)).toEqual(["listen_slow", "sounds", "custom", "first_sound"]);
  });
});

describe("spelling settings by level", () => {
  it("come from the level's rules unless the activity says otherwise", () => {
    expect(resolveSpellingSettings({ config: {}, levelCode: "KG1", activity: "LISTEN_AND_TYPE" }).input).toBe(
      "LETTER_TILES",
    );
    expect(
      resolveSpellingSettings({ config: {}, levelCode: "GRADE2", activity: "LISTEN_AND_TYPE" }).input,
    ).toBe("KEYBOARD");
    expect(
      resolveSpellingSettings({
        config: { input: "DRAG_DROP" },
        levelCode: "GRADE2",
        activity: "LISTEN_AND_TYPE",
      }).input,
    ).toBe("DRAG_DROP");
    const dictation = resolveSpellingSettings({ config: {}, levelCode: "GRADE1", activity: "DICTATION" });
    expect(dictation.replayLimit).toBe(4);
    expect(
      resolveSpellingSettings({ config: {}, levelCode: "GRADE1", activity: "LISTEN_AND_TYPE" }).replayLimit,
    ).toBeNull();
    // Unknown level → the default level's settings.
    expect(resolveSpellingSettings({ config: {}, levelCode: "GRADE9", activity: null }).input).toBe(
      "ON_SCREEN_KEYBOARD",
    );
  });
  it("can be changed as data (learning_rules)", () => {
    const { rules, errors } = mergeLearningRules([
      { code: "spelling", config: { levels: { KG1: { inputMethod: "ON_SCREEN_KEYBOARD" } } } },
    ]);
    expect(errors).toEqual([]);
    expect(rules.spelling.levels.KG1.inputMethod).toBe("ON_SCREEN_KEYBOARD");
    expect(rules.spelling.levels.KG1.maxHints).toBe(DEFAULT_RULES.spelling.levels.KG1.maxHints);
    expect(
      mergeLearningRules([{ code: "spelling", config: { levels: { KG1: { inputMethod: "VOICE" } } } }])
        .errors,
    ).toHaveLength(1);
  });
});

describe("spelling mastery and review", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const at = (day: number) => new Date(Date.UTC(2026, 9, day, 10)).toISOString();

  it("needs repeated, independent evidence", () => {
    const one = computeSpellingProgress(
      [{ isCorrect: true, hintsUsed: 0, attemptedAt: at(1), errorType: null }],
      { now },
    );
    expect(one.status).toBe("LEARNING");
    const hinted = computeSpellingProgress(
      [1, 1, 2, 2].map((d) => ({ isCorrect: true, hintsUsed: 1, attemptedAt: at(d), errorType: null })),
      { now },
    );
    expect(hinted.correct).toBe(0);
    expect(hinted.hinted).toBe(4);
    const solid = computeSpellingProgress(
      [1, 1, 2, 2].map((d) => ({ isCorrect: true, hintsUsed: 0, attemptedAt: at(d), errorType: null })),
      { now },
    );
    expect(solid.status).toBe("MASTERED");
  });

  it("counts error categories and remembers the latest one", () => {
    const p = computeSpellingProgress(
      [
        { isCorrect: false, hintsUsed: 0, attemptedAt: at(1), errorType: "WRONG_DIGRAPH" },
        { isCorrect: false, hintsUsed: 0, attemptedAt: at(2), errorType: "WRONG_VOWEL" },
        { isCorrect: false, hintsUsed: 0, attemptedAt: at(1), errorType: "WRONG_DIGRAPH" },
      ],
      { now },
    );
    expect(p.errorCounts).toEqual({ WRONG_DIGRAPH: 2, WRONG_VOWEL: 1 });
    expect(p.lastErrorType).toBe("WRONG_VOWEL");
  });

  it("puts a missed word in the review queue once (spelling:<id>)", () => {
    const attempts = [{ isCorrect: false, attemptedAt: at(1) }];
    const progress = computeSpellingProgress(
      attempts.map((a) => ({ ...a, hintsUsed: 0, errorType: "WRONG_DIGRAPH" })),
      { now },
    );
    const item = deriveSpellingReview(
      { wordId: "w1", skillId: "s1", lessonId: "l1", attempts, progress },
      now,
    );
    expect(item).toMatchObject({ item_key: "spelling:w1", reason: "missed_spelling", word_id: "w1" });
    expect(
      deriveSpellingReview({ wordId: "w1", skillId: null, lessonId: null, attempts: [], progress }, now),
    ).toBeNull();
  });

  it("reviews a pattern misspelled again and again until it is spelled right twice", () => {
    const base = { patternId: "p1", skillId: "s1", lessonId: "l1" };
    expect(derivePatternReview({ ...base, errorTimes: [at(1)], correctSinceLastError: 0 }, now)).toBeNull();
    expect(
      derivePatternReview({ ...base, errorTimes: [at(1), at(2)], correctSinceLastError: 0 }, now),
    ).toMatchObject({
      item_key: "pattern:p1",
      reason: "spelling_pattern",
      phonics_pattern_id: "p1",
      lesson_id: "l1",
    });
    expect(
      derivePatternReview({ ...base, errorTimes: [at(1), at(2)], correctSinceLastError: 2 }, now),
    ).toBeNull();
    // Old mistakes age out.
    expect(
      derivePatternReview(
        { ...base, errorTimes: ["2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z"], correctSinceLastError: 0 },
        now,
      ),
    ).toBeNull();
  });

  it("summarises for parents without noise", () => {
    const summary = summarizeSpelling(
      [
        {
          wordId: "1",
          word: "ship",
          emoji: "🚢",
          spellingType: "DIGRAPH",
          status: "LEARNING",
          attempts: 4,
          correct: 1,
          hinted: 1,
          accuracy: 25,
          lastErrorType: "WRONG_DIGRAPH",
          lastPracticedAt: at(2),
          familyCodes: ["IP"],
        },
        {
          wordId: "2",
          word: "cat",
          emoji: "🐱",
          spellingType: "CVC",
          status: "MASTERED",
          attempts: 4,
          correct: 4,
          hinted: 0,
          accuracy: 100,
          lastErrorType: null,
          lastPracticedAt: at(1),
          familyCodes: ["AT"],
        },
      ],
      [
        { errorType: "WRONG_DIGRAPH", attempts: 3 },
        { errorType: "wrong_choice", attempts: 9 },
      ],
    );
    expect(summary.wordsPracticed).toBe(2);
    expect(summary.wordsMastered).toBe(1);
    expect(summary.firstTryAccuracy).toBe(62.5);
    expect(summary.errors.map((e) => e.category)).toEqual(["WRONG_DIGRAPH"]);
    expect(summary.weakWords.map((w) => w.word)).toEqual(["ship"]);
    expect(summary.recent[0].word).toBe("ship");
  });
});

describe("spelling trend", () => {
  it("shows first-try accuracy per week and the average answer time", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    const t = spellingTrend(
      [
        { isCorrect: false, responseTimeMs: 4000, attemptedAt: "2026-10-01T10:00:00Z" },
        { isCorrect: true, responseTimeMs: 2000, attemptedAt: "2026-10-02T10:00:00Z" },
        { isCorrect: true, responseTimeMs: 3000, attemptedAt: "2026-10-27T10:00:00Z" },
        { isCorrect: true, responseTimeMs: 9000, attemptedAt: "2026-01-01T10:00:00Z" },
      ],
      now,
    );
    expect(t.weeks.map((w) => w.attempts)).toEqual([2, 0, 0, 1]);
    expect(t.weeks[0].accuracy).toBe(50);
    expect(t.weeks[3].accuracy).toBe(100);
    expect(t.change).toBe(50);
    expect(t.averageResponseMs).toBe(3000);
  });
});
