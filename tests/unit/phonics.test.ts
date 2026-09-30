import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { phonicsFileSchema, type PhonicsFile } from "@/lib/content/content-schemas";
import { validatePhonicsFile } from "@/lib/content/phonics-validation";
import {
  blendStages,
  combinedStars,
  decomposeWord,
  isCvc,
  masteryStars,
  parseAuthoredSegments,
  segmentAt,
  segmentSounds,
  segmentsUsePattern,
  wordHasPattern,
  type PatternInfo,
  type PhonemeInfo,
  type WordPatternLink,
} from "@/lib/learning/phonics";

// The phonics core against the shipped pattern and phoneme inventory.
const file = phonicsFileSchema.parse(
  JSON.parse(readFileSync(path.resolve(__dirname, "../../content/phonics.json"), "utf8")),
);
const phonemes = new Map<string, PhonemeInfo>(
  file.phonemes.map((p) => [
    p.code,
    { code: p.code, ipa: p.ipa, label: p.label, sayAs: p.sayAs, kind: p.kind, voiced: p.voiced },
  ]),
);
const patterns: PatternInfo[] = file.patterns.map((p) => ({
  code: p.code,
  pattern: p.pattern,
  type: p.type,
  position: p.position,
  sounds: p.sounds,
}));
const byCode = new Map(patterns.map((p) => [p.code, p]));
const pattern = (code: string) => byCode.get(code)!;

function split(
  word: string,
  links: WordPatternLink[] = [],
  extra: { irregular?: boolean; authored?: string } = {},
) {
  return decomposeWord({ word, patterns, links, phonemes, ...extra });
}
const graphemes = (word: string, links: WordPatternLink[] = []) =>
  split(word, links).segments.map((s) => s.grapheme);

describe("phonics inventory", () => {
  it("has the 26 letters with a name and a sound each, kept apart", () => {
    const letters = file.patterns.filter((p) => p.type === "letter");
    expect(letters.map((p) => p.pattern).join("")).toBe("abcdefghijklmnopqrstuvwxyz");
    for (const l of letters) {
      expect(l.uppercase, l.code).toBe(l.pattern.toUpperCase());
      expect(l.letterName, l.code).toBeTruthy();
      expect(l.sounds.find((s) => s.primary)?.phonemes.length, l.code).toBeGreaterThan(0);
    }
    // The letter NAME is not its SOUND: "bee" vs /b/.
    const b = file.patterns.find((p) => p.code === "LETTER_B")!;
    expect(b.letterName).not.toBe(b.sounds[0].sayAs);
  });

  it("covers the required digraphs, vowel teams, r-controlled vowels and endings", () => {
    const have = new Set(file.patterns.map((p) => p.pattern));
    for (const p of ["ch", "sh", "th", "ph", "wh", "ck", "ng"]) expect(have.has(p), p).toBe(true);
    for (const p of ["ai", "ay", "ee", "ea", "oa", "ow", "oo", "ou", "oi", "oy"])
      expect(have.has(p), p).toBe(true);
    for (const p of ["ar", "er", "ir", "or", "ur"]) expect(have.has(p), p).toBe(true);
    for (const p of ["ing", "ed", "es", "tion", "sion", "ment", "ness", "ful", "less"])
      expect(have.has(p), p).toBe(true);
  });

  it("keeps the two TH sounds and the several pronunciations of EA, OO, OW and ED separate", () => {
    expect(
      pattern("TH")
        .sounds.map((s) => s.phonemes[0])
        .sort(),
    ).toEqual(["DH", "TH"]);
    for (const code of ["EA", "OO", "OW", "ED"]) expect(pattern(code).sounds.length, code).toBeGreaterThan(1);
    expect(
      pattern("ED")
        .sounds.map((s) => s.phonemes.join(" "))
        .sort(),
    ).toEqual(["D", "IH D", "T"]);
  });

  it("orders the stages from letters to advanced patterns", () => {
    expect(file.stages.map((s) => s.code)).toEqual([
      "LETTERS",
      "LETTER_SOUNDS",
      "BEGINNING_SOUNDS",
      "ENDING_SOUNDS",
      "SHORT_VOWELS",
      "CVC",
      "BLENDING",
      "DIGRAPHS",
      "CONSONANT_BLENDS",
      "LONG_VOWELS",
      "VOWEL_TEAMS",
      "R_CONTROLLED",
      "WORD_ENDINGS",
      "ADVANCED",
    ]);
  });
});

describe("word decomposition", () => {
  it("splits CVC words into three graphemes and three phonemes", () => {
    const cat = split("cat");
    expect(cat.segments.map((s) => s.grapheme)).toEqual(["c", "a", "t"]);
    expect(cat.phonemes).toEqual(["K", "AE", "T"]);
    expect(isCvc(cat.shape)).toBe(true);
    expect(cat.decodable).toBe(true);
    expect(cat.issues).toEqual([]);
  });

  it("treats consonant digraphs as one sound: ship is CVC (SH IH P), not four letters", () => {
    const ship = split("ship", [{ code: "SH" }]);
    expect(ship.segments.map((s) => s.grapheme)).toEqual(["sh", "i", "p"]);
    expect(ship.phonemes).toEqual(["SH", "IH", "P"]);
    expect(ship.shape).toBe("CVC");
    expect(graphemes("duck", [{ code: "CK" }])).toEqual(["d", "u", "ck"]);
    expect(graphemes("ring", [{ code: "NG" }])).toEqual(["r", "i", "ng"]);
  });

  it("uses the linked vowel team and its linked pronunciation", () => {
    const boat = split("boat", [{ code: "OA" }]);
    expect(boat.segments.map((s) => s.grapheme)).toEqual(["b", "oa", "t"]);
    expect(boat.segments[1].patternCode).toBe("OA");
    const bread = split("bread", [{ code: "EA", sound: "EA_SHORT_E" }]);
    expect(bread.segments.find((s) => s.grapheme === "ea")?.phonemes).toEqual(["EH"]);
    const leaf = split("leaf", [{ code: "EA", sound: "EA_LONG_E" }]);
    expect(leaf.segments.find((s) => s.grapheme === "ea")?.phonemes).toEqual(["IY"]);
  });

  it("flags an unlinked vowel team for review instead of guessing", () => {
    const rain = split("rain");
    expect(rain.issues.join(" ")).toMatch(/ai/);
  });

  it("handles magic e: the final e is silent and the vowel says its name", () => {
    const cake = split("cake", [{ code: "A_E" }]);
    const e = cake.segments.at(-1)!;
    expect(e.grapheme).toBe("e");
    expect(e.phonemes).toEqual([]);
    expect(cake.phonemes).toEqual(["K", "EY", "K"]);
    expect(cake.issues).toEqual([]);
  });

  it("gives x two sounds and double consonants one", () => {
    expect(split("box").phonemes).toEqual(["B", "AA", "K", "S"]);
    const bell = split("bell");
    expect(bell.segments.map((s) => s.grapheme)).toEqual(["b", "e", "ll"]);
    expect(bell.phonemes).toEqual(["B", "EH", "L"]);
  });

  it("reads authored splits, including explicit phonemes and silent letters", () => {
    const { segments, issues } = parseAuthoredSegments("sh oe=[UW]", patterns, [{ code: "SH" }]);
    expect(issues).toEqual([]);
    expect(segments.map((s) => [s.grapheme, s.phonemes.join(" ")])).toEqual([
      ["sh", "SH"],
      ["oe", "UW"],
    ]);
    const bad = parseAuthoredSegments("c a=NOPE t", patterns, []);
    expect(bad.issues.join(" ")).toMatch(/unknown sound NOPE/);
    // An authored split wins over the automatic one.
    const juice = split("juice", [], { authored: "j ui=[UW] ce=[S]" });
    expect(juice.phonemes).toEqual(["JH", "UW", "S"]);
  });

  it("does not flag irregular words it cannot decode", () => {
    const said = split("said", [], { irregular: true });
    expect(said.decodable).toBe(false);
  });

  it("matches patterns to words by position rules", () => {
    expect(wordHasPattern("jumping", pattern("ING"))).toBe(true);
    expect(wordHasPattern("kingdom", { pattern: "ing", position: "final", type: "word_ending" })).toBe(false);
    expect(wordHasPattern("singing", pattern("NG"))).toBe(true);
    expect(wordHasPattern("cake", pattern("A_E"))).toBe(true);
    expect(wordHasPattern("cat", pattern("A_E"))).toBe(false);
  });

  it("knows a letter inside a blend is heard, but a letter inside a digraph is not", () => {
    const star = split("star", [{ code: "ST" }, { code: "AR" }]);
    expect(segmentsUsePattern(star.segments, pattern("LETTER_S"), byCode)).toBe(true);
    const ship = split("ship", [{ code: "SH" }]);
    expect(segmentsUsePattern(ship.segments, pattern("LETTER_S"), byCode)).toBe(false);
    expect(segmentsUsePattern(ship.segments, pattern("SH"), byCode)).toBe(true);
  });
});

describe("blending and segmenting", () => {
  it("builds blending stages c → ca → cat", () => {
    expect(blendStages(3)).toEqual([[0], [0, 1], [0, 1, 2]]);
    expect(blendStages(0)).toEqual([]);
  });

  it("counts phonemes, not letters", () => {
    const fish = split("fish", [{ code: "SH" }]);
    expect(segmentSounds(fish.segments, phonemes).map((s) => s.code)).toEqual(["F", "IH", "SH"]);
    const cake = split("cake", [{ code: "A_E" }]);
    expect(segmentSounds(cake.segments, phonemes)).toHaveLength(3);
    expect(segmentSounds(split("box").segments, phonemes)).toHaveLength(4);
  });

  it("finds the beginning, middle and end sound", () => {
    const ship = split("ship", [{ code: "SH" }]).segments;
    expect(segmentAt(ship, "beginning", phonemes)?.grapheme).toBe("sh");
    expect(segmentAt(ship, "middle", phonemes)?.grapheme).toBe("i");
    expect(segmentAt(ship, "end", phonemes)?.grapheme).toBe("p");
    const cake = split("cake", [{ code: "A_E" }]).segments;
    expect(segmentAt(cake, "end", phonemes)?.grapheme).toBe("k");
    expect(segmentAt([], "end", phonemes)).toBeNull();
  });
});

describe("stars", () => {
  it("turns mastery into 0–3 stars", () => {
    expect(masteryStars("NOT_STARTED")).toBe(0);
    expect(masteryStars("LEARNING")).toBe(1);
    expect(masteryStars("PRACTICING")).toBe(2);
    expect(masteryStars("ALMOST_MASTERED")).toBe(2);
    expect(masteryStars("MASTERED")).toBe(3);
  });

  it("combines skills into one row, ignoring skills not started", () => {
    expect(combinedStars([])).toEqual({ stars: 0, started: 0 });
    expect(combinedStars(["NOT_STARTED", "NOT_STARTED"])).toEqual({ stars: 0, started: 0 });
    expect(combinedStars(["MASTERED", "MASTERED", "NOT_STARTED"])).toEqual({ stars: 3, started: 2 });
    expect(combinedStars(["MASTERED", "LEARNING"]).stars).toBe(2);
    expect(combinedStars(["LEARNING"]).stars).toBe(1);
  });
});

describe("phonics content validation", () => {
  const levels = new Set(["KG1", "KG2", "KG3", "GRADE1", "GRADE2"]);
  const clone = (): PhonicsFile => structuredClone(file);

  it("accepts the shipped file", () => {
    expect(validatePhonicsFile(file, levels).errors).toEqual([]);
  });

  it("rejects duplicate codes, unknown levels, stages and phonemes", () => {
    const f = clone();
    f.patterns.push({ ...f.patterns[0] });
    f.patterns[1] = { ...f.patterns[1], level: "GRADE9" };
    f.patterns[2] = { ...f.patterns[2], stage: "NOPE" };
    f.patterns[3] = {
      ...f.patterns[3],
      sounds: [{ ...f.patterns[3].sounds[0], phonemes: ["QQ"] }],
    };
    const rules = validatePhonicsFile(f, levels).errors.map((e) => e.rule);
    expect(rules).toEqual(
      expect.arrayContaining(["duplicate_pattern", "unknown_level", "unknown_stage", "unknown_phoneme"]),
    );
  });

  it("requires a letter's uppercase form and name, and phonemes for every sound", () => {
    const f = clone();
    const a = f.patterns.findIndex((p) => p.code === "LETTER_A");
    f.patterns[a] = { ...f.patterns[a], uppercase: undefined, letterName: "" };
    const sh = f.patterns.findIndex((p) => p.code === "SH");
    f.patterns[sh] = { ...f.patterns[sh], sounds: [{ ...f.patterns[sh].sounds[0], phonemes: [] }] };
    const errors = validatePhonicsFile(f, levels).errors;
    expect(errors.some((e) => e.key === "LETTER_A")).toBe(true);
    expect(errors.some((e) => e.key === "SH")).toBe(true);
  });

  it("rejects relations to unknown or the same pattern", () => {
    const f = clone();
    const sh = f.patterns.findIndex((p) => p.code === "SH");
    f.patterns[sh] = {
      ...f.patterns[sh],
      relations: [
        { code: "SH", type: "related" },
        { code: "ZZ", type: "contrast" },
      ],
    };
    const rules = validatePhonicsFile(f, levels)
      .errors.filter((e) => e.key === "SH")
      .map((e) => e.rule);
    expect(rules.length).toBeGreaterThanOrEqual(2);
  });
});
