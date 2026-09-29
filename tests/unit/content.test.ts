import { describe, expect, it } from "vitest";
import { parseCsv, parsePatternCell, parseWordsCsv } from "@/lib/content/csv";
import { parseQuestion } from "@/lib/content/question-schemas";
import { expandTemplate, seededShuffle, TemplateError, type TemplateContext } from "@/lib/content/templates";

describe("parseQuestion", () => {
  const options = [
    { id: "ship", text: "ship" },
    { id: "chip", text: "chip" },
  ];

  it("accepts a valid multiple-choice question", () => {
    expect(parseQuestion("MULTIPLE_CHOICE", { options }, { accepted: ["ship"] }).ok).toBe(true);
  });

  it("rejects an answer that is not one of the options", () => {
    const result = parseQuestion("MULTIPLE_CHOICE", { options }, { accepted: ["shop"] });
    expect(result).toEqual({ ok: false, error: "answer must reference an option id" });
  });

  it("rejects unknown types and malformed content", () => {
    expect(parseQuestion("HOLOGRAM", {}, null).ok).toBe(false);
    expect(parseQuestion("MULTIPLE_CHOICE", { options: [options[0]] }, { accepted: ["ship"] }).ok).toBe(
      false,
    );
  });

  it("requires exactly one blank in a missing-letter question", () => {
    const content = { word: "ship", parts: [{ text: "ip" }], choices: ["sh", "ch"] };
    expect(parseQuestion("MISSING_LETTER", content, { accepted: ["sh"] }).ok).toBe(false);
  });

  it("checks that word-builder tiles can build the answer", () => {
    const content = { tiles: ["sh", "i", "p"], slots: 3 };
    expect(parseQuestion("WORD_BUILDER", content, { accepted: ["ship"] }).ok).toBe(true);
    expect(parseQuestion("WORD_BUILDER", content, { accepted: ["shop"] })).toMatchObject({ ok: false });
  });

  it("checks that sentence answers use exactly the given tokens", () => {
    const content = { tokens: ["cat.", "I", "see", "a"] };
    expect(
      parseQuestion("SENTENCE_BUILDER", content, { acceptedSequences: [["I", "see", "a", "cat."]] }).ok,
    ).toBe(true);
    expect(parseQuestion("SENTENCE_BUILDER", content, { acceptedSequences: [["I", "see", "cat."]] }).ok).toBe(
      false,
    );
  });

  it("treats INTRO as unscored", () => {
    expect(parseQuestion("INTRO", { heading: "sh" }, null)).toMatchObject({
      ok: true,
      question: { answer: null },
    });
  });
});

const ctx: TemplateContext = {
  seed: "q-1",
  word: (text) =>
    ({
      ship: { word: "ship", emoji: "🚢", childDefinition: "A big boat.", patterns: [{ code: "SH" }] },
      chip: { word: "chip", emoji: "🥔", childDefinition: "", patterns: [{ code: "CH" }] },
      dog: { word: "dog", emoji: "🐶", childDefinition: "", patterns: [] },
      thumb: {
        word: "thumb",
        emoji: "👍",
        childDefinition: "",
        patterns: [{ code: "TH", sound: "TH_VOICELESS" }],
      },
    })[text],
  pattern: (code) =>
    ({
      SH: {
        code: "SH",
        pattern: "sh",
        type: "consonant_digraph",
        childExplanation: "s and h say",
        sounds: [{ code: "SH", label: "sh as in ship", sayAs: "shh", primary: true }],
      },
      TH: {
        code: "TH",
        pattern: "th",
        type: "consonant_digraph",
        childExplanation: "",
        sounds: [
          { code: "TH_VOICELESS", label: "th as in thumb", sayAs: "th, as in thumb", primary: true },
          { code: "TH_VOICED", label: "th as in this", sayAs: "th, as in this", primary: false },
        ],
      },
    })[code],
};

describe("templates", () => {
  it("expands a listen-and-choose question from the word bank, and it validates", () => {
    const q = expandTemplate("listen_pick_picture", { word: "ship", distractors: ["chip", "dog"] }, ctx);
    expect(q.type).toBe("LISTEN_AND_CHOOSE");
    expect(q.promptSpeech).toBe("ship");
    expect(parseQuestion(q.type, q.content, q.answer).ok).toBe(true);
  });

  it("is deterministic for the same seed", () => {
    const a = expandTemplate("listen_pick_picture", { word: "ship", distractors: ["chip", "dog"] }, ctx);
    const b = expandTemplate("listen_pick_picture", { word: "ship", distractors: ["chip", "dog"] }, ctx);
    expect(a).toEqual(b);
  });

  it("builds a missing-pattern question around the gap", () => {
    const q = expandTemplate("missing_pattern", { word: "ship", missing: "sh", choices: ["ch", "th"] }, ctx);
    expect(q.content.parts).toEqual([{ blank: true }, { text: "ip" }]);
    expect(parseQuestion(q.type, q.content, q.answer).ok).toBe(true);
  });

  it("uses the word's recorded sound for multi-sound patterns", () => {
    const q = expandTemplate("pick_pattern_sound", { pattern: "TH", word: "thumb" }, ctx);
    expect(q.answer).toEqual({ accepted: ["th-voiceless"] });
    expect((q.content.options as unknown[]).length).toBe(2);
  });

  it("reports missing words and unknown templates", () => {
    expect(() => expandTemplate("listen_pick_picture", { word: "zebra", distractors: [] }, ctx)).toThrow(
      TemplateError,
    );
    expect(() => expandTemplate("nope", {}, ctx)).toThrow(/unknown template/);
  });

  it("shuffles without returning the original order when asked", () => {
    expect(seededShuffle(["I", "see", "a", "cat."], "x", true)).not.toEqual(["I", "see", "a", "cat."]);
  });
});

describe("words CSV", () => {
  it("parses quoted fields, commas and escaped quotes", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\n1,2,3\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });

  it("parses phonics pattern cells with sounds and example markers", () => {
    expect(parsePatternCell("TH:th_voiced*; ee")).toEqual([
      { code: "TH", sound: "TH_VOICED", example: true },
      { code: "EE", sound: undefined, example: false },
    ]);
  });

  it("validates rows and reports invalid ones by line", () => {
    const csv = [
      "word,level,category,difficulty,phonics_pattern,definition,example_sentence,sight_word",
      "ship,KG3,TRANSPORTATION,2,SH*,A big boat.,The ship sails.,no",
      "bad,KG3,,eleven,,,,no",
    ].join("\n");
    const { rows, missingColumns } = parseWordsCsv(csv);
    expect(missingColumns).toEqual([]);
    expect(rows[0]).toMatchObject({ ok: true, word: { word: "ship", level: "KG3", sightWord: false } });
    expect(rows[1]).toMatchObject({ ok: false, line: 3 });
  });

  it("reports missing required columns", () => {
    expect(parseWordsCsv("word,level\ncat,KG1").missingColumns).toContain("difficulty");
  });
});
