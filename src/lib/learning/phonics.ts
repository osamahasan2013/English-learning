import type { MasteryStatus } from "@/lib/learning/mastery";

// The phonics core, pure and shared by the importer, the lesson templates, the phonics
// screens and the tests. Graphemes (what is written: "sh", "a", "igh") and phonemes (what
// is said: SH, AE — ARPAbet codes, see the `phonemes` table) are kept apart everywhere:
// a word is a sequence of grapheme segments, and each segment stands for a sequence of
// zero (silent e) or more phonemes (x = K S).

export type PhonemeKind = "consonant" | "vowel" | "r_colored_vowel";

export type PhonemeInfo = {
  code: string;
  ipa: string;
  label: string;
  sayAs: string;
  kind: PhonemeKind;
  voiced: boolean;
};

export type PatternPosition = "any" | "initial" | "medial" | "final";

export type PatternSoundInfo = {
  code: string;
  label: string;
  sayAs: string;
  phonemes: string[];
  primary: boolean;
};

export type PatternInfo = {
  code: string;
  // Lowercase grapheme; "a_e" marks a split vowel-consonant-e pattern.
  pattern: string;
  type: string;
  position: PatternPosition;
  sounds: PatternSoundInfo[];
};

export type Segment = {
  grapheme: string;
  patternCode: string | null;
  soundCode: string | null;
  phonemes: string[];
  // Speakable approximation of this segment's sound ("" when silent).
  sayAs: string;
};

export type WordPatternLink = { code: string; sound?: string };

export type Decomposition = {
  segments: Segment[];
  phonemes: string[];
  shape: string;
  decodable: boolean;
  // Reasons the split may be wrong, for admin review (never auto-corrected).
  issues: string[];
};

// Pattern types that are (almost) always read as one unit wherever they appear, so the
// automatic split may use them even when a word does not list them.
const ALWAYS_UNIT_TYPES = new Set(["consonant_digraph", "trigraph"]);
// Types only used at the very end of a word.
const ENDING_TYPES = new Set(["word_ending", "suffix"]);

export function isSplitPattern(pattern: string) {
  return /^[a-z]_[a-z]$/.test(pattern);
}

// Does the written word contain this pattern? Endings must end the word; a pattern's
// `position` (ck and ng usually final, wh initial) is teaching information, not a rule —
// "singing" has ng in the middle.
export function wordHasPattern(word: string, pattern: Pick<PatternInfo, "pattern" | "position" | "type">) {
  const w = word.toLowerCase();
  if (isSplitPattern(pattern.pattern)) {
    const [vowel, e] = pattern.pattern.split("_");
    return new RegExp(`${vowel}[b-df-hj-np-tv-z]{1,2}${e}(s|d)?$`).test(w);
  }
  if (ENDING_TYPES.has(pattern.type)) return w.endsWith(pattern.pattern);
  return w.includes(pattern.pattern);
}

const VOWEL_LETTERS = new Set(["a", "e", "i", "o", "u"]);

function soundFor(pattern: PatternInfo, links: WordPatternLink[]): PatternSoundInfo | null {
  const link = links.find((l) => l.code === pattern.code);
  if (link?.sound) return pattern.sounds.find((s) => s.code === link.sound) ?? null;
  return pattern.sounds.find((s) => s.primary) ?? pattern.sounds[0] ?? null;
}

function toSegment(grapheme: string, pattern: PatternInfo | null, sound: PatternSoundInfo | null): Segment {
  return {
    grapheme,
    patternCode: pattern?.code ?? null,
    soundCode: sound?.code ?? null,
    phonemes: sound?.phonemes ?? [],
    sayAs: sound?.sayAs ?? "",
  };
}

// Authored split, one token per grapheme:  "c a=A_LONG k e="
//   g          — the grapheme's pattern and its linked/primary sound
//   g=CODE     — that pattern's pronunciation CODE
//   g=         — silent
//   g=[K S]    — explicit phonemes (for graphemes that are not a taught pattern)
export function parseAuthoredSegments(
  spec: string,
  patterns: PatternInfo[],
  links: WordPatternLink[],
): { segments: Segment[]; issues: string[] } {
  const issues: string[] = [];
  const segments = spec
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const match = token.match(/^([a-z']+)(?:=(.*))?$/);
      if (!match) {
        issues.push(`cannot read segment "${token}"`);
        return toSegment(token.toLowerCase(), null, null);
      }
      const [, grapheme, value] = match;
      const pattern = pickPatternForGrapheme(grapheme, patterns, links);
      if (value === undefined) {
        if (!pattern) issues.push(`no phonics pattern for "${grapheme}"`);
        return toSegment(grapheme, pattern, pattern ? soundFor(pattern, links) : null);
      }
      if (value === "") return toSegment(grapheme, pattern, null);
      const explicit = value.match(/^\[([A-Z ]+)\]$/);
      if (explicit) {
        const phonemes = explicit[1].trim().split(/\s+/);
        return { grapheme, patternCode: pattern?.code ?? null, soundCode: null, phonemes, sayAs: "" };
      }
      const owner = patterns.find((p) => p.sounds.some((s) => s.code === value));
      const sound = owner?.sounds.find((s) => s.code === value) ?? null;
      if (!sound) issues.push(`unknown sound ${value} for "${grapheme}"`);
      return toSegment(grapheme, owner ?? pattern, sound);
    });
  return { segments, issues };
}

function pickPatternForGrapheme(grapheme: string, patterns: PatternInfo[], links: WordPatternLink[]) {
  const candidates = patterns.filter((p) => p.pattern === grapheme);
  return (
    candidates.find((p) => links.some((l) => l.code === p.code)) ??
    candidates.find((p) => p.type === "letter") ??
    candidates[0] ??
    null
  );
}

// Automatic split: longest match from the left. Consonant digraphs are always one unit;
// other multi-letter patterns (vowel teams, blends, r-controlled, endings) only when the
// word is linked to them, so "boat" is b·oa·t because it is linked to OA, and an unlinked
// vowel team is flagged instead of guessed. Split patterns (a_e) come from the links.
export function decomposeWord(args: {
  word: string;
  patterns: PatternInfo[];
  links: WordPatternLink[];
  phonemes: ReadonlyMap<string, PhonemeInfo>;
  irregular?: boolean;
  authored?: string;
}): Decomposition {
  const word = args.word.toLowerCase();
  const linkedCodes = new Set(args.links.map((l) => l.code));
  const byCode = new Map(args.patterns.map((p) => [p.code, p]));
  let segments: Segment[];
  const issues: string[] = [];

  if (args.authored?.trim()) {
    const authored = parseAuthoredSegments(args.authored, args.patterns, args.links);
    segments = authored.segments;
    issues.push(...authored.issues);
    if (segments.map((s) => s.grapheme).join("") !== word.replace(/[^a-z']/g, ""))
      issues.push(`authored segments do not spell "${args.word}"`);
  } else {
    const split = args.links
      .map((l) => byCode.get(l.code))
      .find((p): p is PatternInfo => !!p && isSplitPattern(p.pattern) && wordHasPattern(word, p));
    let splitVowelAt = -1;
    let splitEAt = -1;
    if (split) {
      const [vowel] = split.pattern.split("_");
      const m = word.match(new RegExp(`${vowel}([b-df-hj-np-tv-z]{1,2})e(s|d)?$`));
      if (m && m.index !== undefined) {
        splitVowelAt = m.index;
        splitEAt = m.index + 1 + m[1].length;
      }
    }
    const multi = args.patterns
      .filter((p) => p.pattern.length > 1 && !isSplitPattern(p.pattern))
      .sort((a, b) => b.pattern.length - a.pattern.length);
    segments = [];
    let i = 0;
    while (i < word.length) {
      if (split && i === splitVowelAt) {
        segments.push(toSegment(word[i], split, soundFor(split, args.links)));
        i++;
        continue;
      }
      if (split && i === splitEAt) {
        segments.push(toSegment(word[i], split, null));
        i++;
        continue;
      }
      const unit = multi.find((p) => {
        if (!word.startsWith(p.pattern, i)) return false;
        const end = i + p.pattern.length;
        if (ENDING_TYPES.has(p.type) && end !== word.length) return false;
        if (split && splitVowelAt >= i && splitVowelAt < end) return false;
        return ALWAYS_UNIT_TYPES.has(p.type) || linkedCodes.has(p.code);
      });
      if (unit) {
        segments.push(toSegment(unit.pattern, unit, soundFor(unit, args.links)));
        i += unit.pattern.length;
        continue;
      }
      const letter = word[i];
      const letterPattern = args.patterns.find((p) => p.type === "letter" && p.pattern === letter) ?? null;
      const hasVowelBefore = [...word.slice(0, i)].some((ch) => VOWEL_LETTERS.has(ch));
      // Double consonants are one sound: be-ll, e-gg, pu-pp-y.
      if (letterPattern && !VOWEL_LETTERS.has(letter) && word[i + 1] === letter) {
        segments.push(toSegment(letter + letter, letterPattern, soundFor(letterPattern, args.links)));
        i += 2;
        continue;
      }
      // A final e after a consonant is usually silent (house, giraffe). If it makes the
      // vowel before it long, the word should be linked to a_e, i_e, ...
      if (
        letter === "e" &&
        i === word.length - 1 &&
        i >= 2 &&
        hasVowelBefore &&
        !VOWEL_LETTERS.has(word[i - 1])
      ) {
        segments.push(toSegment("e", letterPattern, null));
        if (/(^|[^aeiou])[aiou][b-df-hj-np-tv-z]e$/.test(word) && !split)
          issues.push("ends in vowel-consonant-e; link a_e/i_e/o_e/u_e if the vowel is long");
        i++;
        continue;
      }
      // Final y after a consonant is a vowel: /iː/ in longer words (happy), /aɪ/ in short
      // ones (my, fly).
      if (
        letter === "y" &&
        i === word.length - 1 &&
        i > 0 &&
        !VOWEL_LETTERS.has(word[i - 1]) &&
        letterPattern
      ) {
        const linked = args.links.find((l) => l.code === letterPattern.code)?.sound;
        const code = linked ?? (hasVowelBefore ? "Y_LONG_E" : "Y_LONG_I");
        segments.push(
          toSegment("y", letterPattern, letterPattern.sounds.find((x) => x.code === code) ?? null),
        );
        i++;
        continue;
      }
      // A final "s" on a word linked to the -s ending is the ending, not the letter.
      const ending =
        i === word.length - 1
          ? args.patterns.find(
              (p) => ENDING_TYPES.has(p.type) && p.pattern === letter && linkedCodes.has(p.code),
            )
          : undefined;
      const pattern = ending ?? letterPattern;
      if (!pattern) issues.push(`no phonics pattern for "${letter}"`);
      segments.push(toSegment(letter, pattern, pattern ? soundFor(pattern, args.links) : null));
      i++;
    }
    // A vowel team or r-controlled spelling the word is not linked to (and that is not
    // just part of a longer linked pattern, like "ai" in "air") may be split wrongly.
    const linkedTexts = args.links.map((l) => byCode.get(l.code)?.pattern ?? "").filter((t) => t.length > 1);
    for (const p of args.patterns) {
      const team = p.type === "vowel_team" || p.type === "r_controlled";
      const covered = linkedTexts.some((t) => t !== p.pattern && t.includes(p.pattern) && word.includes(t));
      if (team && !linkedCodes.has(p.code) && !covered && word.includes(p.pattern))
        issues.push(`contains "${p.pattern}" but is not linked to ${p.code}; check the split`);
    }
  }

  // Every linked pattern should be visible in the word ("example words must contain the
  // pattern"), and in the split.
  for (const link of args.links) {
    const p = byCode.get(link.code);
    if (!p) continue;
    if (!wordHasPattern(word, p)) issues.push(`linked to ${p.code} but does not contain "${p.pattern}"`);
    else if (!segmentsUsePattern(segments, p, byCode))
      issues.push(`linked to ${p.code} but the split does not use it`);
  }

  const phonemes = segments.flatMap((s) => s.phonemes);
  for (const code of phonemes) if (!args.phonemes.has(code)) issues.push(`unknown phoneme ${code}`);
  const silentOk = (s: Segment) => s.phonemes.length > 0 || (s.patternCode !== null && s.soundCode === null);
  const decodable =
    !args.irregular &&
    issues.length === 0 &&
    segments.every((s) => s.patternCode !== null && silentOk(s)) &&
    phonemes.length > 0;
  return { segments, phonemes, shape: phonicsShape(phonemes, args.phonemes), decodable, issues };
}

// Does the split use this pattern? A letter inside a consonant blend counts (the s in
// "star" is heard); a letter inside a digraph does not (no s sound in "ship").
export function segmentsUsePattern(
  segments: Pick<Segment, "grapheme" | "patternCode">[],
  pattern: Pick<PatternInfo, "code" | "pattern" | "type">,
  patternsByCode: ReadonlyMap<string, Pick<PatternInfo, "type">>,
) {
  return segments.some(
    (s) =>
      s.patternCode === pattern.code ||
      (pattern.type === "letter" &&
        s.patternCode !== null &&
        patternsByCode.get(s.patternCode)?.type === "consonant_blend" &&
        s.grapheme.includes(pattern.pattern)),
  );
}

// CVC, CCVC, CVCC... from the phoneme sequence (so "ship" is CVC: SH IH P).
export function phonicsShape(phonemes: string[], inventory: ReadonlyMap<string, PhonemeInfo>) {
  return phonemes
    .map((code) => {
      const kind = inventory.get(code)?.kind;
      return kind === undefined ? "" : kind === "consonant" ? "C" : "V";
    })
    .join("")
    .slice(0, 12);
}

export function isCvc(shape: string) {
  return shape === "CVC";
}

// Blending: the sounds one by one, then growing groups, then the whole word.
//   cat → [c] [c a] [c a t]
export function blendStages(segmentCount: number): number[][] {
  return Array.from({ length: segmentCount }, (_, i) => Array.from({ length: i + 1 }, (_, j) => j));
}

// The phonemes a child should hear when segmenting a word ("how many sounds?"): silent
// graphemes contribute none, "x" contributes two.
export function segmentSounds(segments: Segment[], inventory: ReadonlyMap<string, PhonemeInfo>) {
  return segments.flatMap((s) =>
    s.phonemes.map((code) => {
      const p = inventory.get(code);
      return {
        code,
        label: p?.label ?? code.toLowerCase(),
        sayAs: p?.sayAs ?? code.toLowerCase(),
        grapheme: s.grapheme,
      };
    }),
  );
}

// Which segment is "the beginning / middle / end sound": the first or last sounding
// segment, or the first vowel sound in between.
export function segmentAt(
  segments: Segment[],
  position: "beginning" | "middle" | "end",
  inventory: ReadonlyMap<string, PhonemeInfo>,
): Segment | null {
  const sounding = segments.filter((s) => s.phonemes.length > 0);
  if (sounding.length === 0) return null;
  if (position === "beginning") return sounding[0];
  if (position === "end") return sounding[sounding.length - 1];
  const inner = sounding.slice(1, -1);
  return (
    inner.find((s) => s.phonemes.some((c) => inventory.get(c)?.kind !== "consonant")) ?? inner[0] ?? null
  );
}

// Child-friendly mastery: stars instead of percentages.
export function masteryStars(status: MasteryStatus): 0 | 1 | 2 | 3 {
  switch (status) {
    case "NOT_STARTED":
      return 0;
    case "LEARNING":
      return 1;
    case "PRACTICING":
    case "ALMOST_MASTERED":
      return 2;
    case "MASTERED":
      return 3;
  }
}

// Several skills shown as one row ("Letters"): the typical star count of the skills
// started so far, and how many of them are started.
export function combinedStars(statuses: MasteryStatus[]): { stars: 0 | 1 | 2 | 3; started: number } {
  const started = statuses.filter((s) => s !== "NOT_STARTED");
  if (started.length === 0) return { stars: 0, started: 0 };
  const avg = started.reduce((n, s) => n + masteryStars(s), 0) / started.length;
  return { stars: Math.max(1, Math.min(3, Math.floor(avg + 0.001))) as 1 | 2 | 3, started: started.length };
}
