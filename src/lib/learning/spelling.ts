import { computeMastery, type MasteryStatus } from "@/lib/learning/mastery";
import type { ReviewItemRow } from "@/lib/learning/review-queue";
import { DEFAULT_RULES, type InputMethod, type LearningRules } from "@/lib/learning/rules";

// The spelling engine's pure core, shared by the device (instant feedback), the server
// (authoritative analysis of every stored answer), the importer and the tests. No I/O and
// no external services: every result is deterministic.
//
//   * normalizeSpelling — trim, lower case, single spaces. Nothing is autocorrected; the
//     child's own text is always kept as it was typed.
//   * analyzeSpelling   — right or wrong, the letter-by-letter difference and ONE error
//     category, using the word's grapheme split (ship = sh·i·p) so a mistake can be named
//     in phonics terms: ship → sip is a wrong digraph in SH.
//   * analyzeSentence   — sentence dictation: word order, missing / extra words, each
//     word's spelling and basic punctuation.
//   * hints, spelling mastery (the mastery algorithm with the spelling rule set) and the
//     spelling review items.

// ---------------------------------------------------------------------------------------
// Vocabulary of the engine

export const SPELLING_ERROR_CATEGORIES = [
  "MISSING_LETTER",
  "EXTRA_LETTER",
  "SUBSTITUTED_LETTER",
  "TRANSPOSITION",
  "WRONG_VOWEL",
  "WRONG_DIGRAPH",
  "WRONG_BLEND",
  "WRONG_ENDING",
  "PHONETIC_APPROXIMATION",
  "UNKNOWN",
] as const;
export type SpellingErrorCategory = (typeof SPELLING_ERROR_CATEGORIES)[number];

// Sentence dictation adds sentence-level categories.
export const SENTENCE_ERROR_CATEGORIES = ["WORD_ORDER", "MISSING_WORD", "EXTRA_WORD", "PUNCTUATION"] as const;
export type SentenceErrorCategory = (typeof SENTENCE_ERROR_CATEGORIES)[number];
export type SpellingErrorType = SpellingErrorCategory | SentenceErrorCategory;

export function isSpellingErrorType(value: unknown): value is SpellingErrorType {
  return (
    typeof value === "string" &&
    ((SPELLING_ERROR_CATEGORIES as readonly string[]).includes(value) ||
      (SENTENCE_ERROR_CATEGORIES as readonly string[]).includes(value))
  );
}

// Parent-facing names (the child hears feedback_messages rows instead).
export const SPELLING_ERROR_LABELS: Record<
  SpellingErrorType,
  { label: string; emoji: string; help: string }
> = {
  MISSING_LETTER: { label: "Missing letter", emoji: "➖", help: "Left a letter out (ct for cat)." },
  EXTRA_LETTER: { label: "Extra letter", emoji: "➕", help: "Added a letter (catt for cat)." },
  SUBSTITUTED_LETTER: { label: "Wrong letter", emoji: "🔁", help: "Used a different letter (cap for cat)." },
  TRANSPOSITION: { label: "Letters swapped", emoji: "🔀", help: "Two letters in the wrong order (shpi)." },
  WRONG_VOWEL: {
    label: "Vowel sound",
    emoji: "🅰️",
    help: "The vowel was spelled wrong (cot for cat, ran for rain).",
  },
  WRONG_DIGRAPH: {
    label: "Two-letter sound",
    emoji: "🔤",
    help: "A digraph was spelled wrong (sip for ship).",
  },
  WRONG_BLEND: {
    label: "Consonant blend",
    emoji: "🧩",
    help: "A letter of a blend was missed (sop for stop).",
  },
  WRONG_ENDING: {
    label: "Word ending",
    emoji: "🔚",
    help: "The ending was spelled wrong (jumpt for jumped).",
  },
  PHONETIC_APPROXIMATION: {
    label: "Spelled like it sounds",
    emoji: "👂",
    help: "A sensible guess from the sounds (kat for cat, sed for said).",
  },
  UNKNOWN: { label: "Other", emoji: "❓", help: "Far from the word." },
  WORD_ORDER: { label: "Word order", emoji: "↔️", help: "The right words in the wrong order." },
  MISSING_WORD: { label: "Missing word", emoji: "🕳️", help: "Left a word out of the sentence." },
  EXTRA_WORD: { label: "Extra word", emoji: "➕", help: "Added a word to the sentence." },
  PUNCTUATION: { label: "Capital / full stop", emoji: "✒️", help: "Forgot the capital letter or end mark." },
};

// The default spelling types (the spelling_types table is the real, extensible list).
export const DEFAULT_SPELLING_TYPES = [
  "CVC",
  "CVCC",
  "CCVC",
  "CCVCC",
  "DIGRAPH",
  "BLEND",
  "LONG_VOWEL",
  "VOWEL_TEAM",
  "R_CONTROLLED",
  "WORD_ENDING",
  "SIGHT_WORD",
  "HIGH_FREQUENCY",
  "IRREGULAR",
  "MULTISYLLABIC",
] as const;

// Spelling activities and the question type that plays each one. Several activities share
// a renderer and evaluator (they differ by content `mode`); the activity is recorded on the
// question (metadata.spellingActivity) so analytics can tell them apart.
export const SPELLING_ACTIVITIES = [
  "LISTEN_AND_TYPE",
  "BUILD_THE_WORD",
  "MISSING_LETTER",
  "MISSING_SOUND",
  "SOUND_TO_WORD",
  "WORD_TO_SOUNDS",
  "SCRAMBLED_WORD",
  "DICTATION",
  "SENTENCE_DICTATION",
] as const;
export type SpellingActivity = (typeof SPELLING_ACTIVITIES)[number];

export const SPELLING_ACTIVITY_INFO: Record<
  SpellingActivity,
  { questionType: string; label: string; emoji: string; usesInput: boolean }
> = {
  LISTEN_AND_TYPE: { questionType: "SPELLING", label: "Listen and type", emoji: "👂", usesInput: true },
  BUILD_THE_WORD: { questionType: "WORD_BUILDER", label: "Build the word", emoji: "🧱", usesInput: false },
  MISSING_LETTER: { questionType: "MISSING_LETTER", label: "Missing letter", emoji: "🔡", usesInput: false },
  MISSING_SOUND: { questionType: "MISSING_LETTER", label: "Missing sound", emoji: "🔉", usesInput: false },
  SOUND_TO_WORD: {
    questionType: "BLEND_SOUNDS / SPELLING",
    label: "Sounds to word",
    emoji: "🔗",
    usesInput: true,
  },
  WORD_TO_SOUNDS: { questionType: "SEGMENT_WORD", label: "Word to sounds", emoji: "✂️", usesInput: false },
  SCRAMBLED_WORD: { questionType: "WORD_BUILDER", label: "Scrambled word", emoji: "🔀", usesInput: false },
  DICTATION: { questionType: "SPELLING", label: "Dictation", emoji: "📝", usesInput: true },
  SENTENCE_DICTATION: {
    questionType: "SENTENCE_DICTATION",
    label: "Sentence dictation",
    emoji: "🗒️",
    usesInput: true,
  },
};

export function isSpellingActivity(value: unknown): value is SpellingActivity {
  return typeof value === "string" && (SPELLING_ACTIVITIES as readonly string[]).includes(value);
}

export function spellingActivityOf(metadata: unknown): SpellingActivity | null {
  const tagged =
    metadata && typeof metadata === "object"
      ? (metadata as { spellingActivity?: unknown }).spellingActivity
      : undefined;
  return isSpellingActivity(tagged) ? tagged : null;
}

// Answers that count as evidence of spelling a word (spelling mastery): the activities
// that make the child produce the word's letters. Segmenting (WORD_TO_SOUNDS), choosing a
// word from its sounds and sentence
// dictation are practised but not counted for one word. Questions without an activity
// count when they are about the word's spelling (word area "spelling").
const EVIDENCE_ACTIVITIES = new Set<SpellingActivity>([
  "LISTEN_AND_TYPE",
  "DICTATION",
  "BUILD_THE_WORD",
  "SCRAMBLED_WORD",
  "MISSING_LETTER",
  "MISSING_SOUND",
]);
export function isSpellingEvidence(metadata: unknown, wordArea: string | null) {
  const activity = spellingActivityOf(metadata);
  // Sounds to word counts only when the word is written (not when it is chosen).
  if (activity === "SOUND_TO_WORD") return wordArea === "spelling";
  return activity ? EVIDENCE_ACTIVITIES.has(activity) : wordArea === "spelling";
}

// Question types whose answers get a spelling analysis.
export const SPELLING_ANALYSIS_TYPES = new Set([
  "SPELLING",
  "WORD_BUILDER",
  "MISSING_LETTER",
  "SENTENCE_DICTATION",
]);

// Speech input is NOT IMPLEMENTED (future feature): no microphone, no third-party API.
export const SPEECH_INPUT_SUPPORTED = false;

// ---------------------------------------------------------------------------------------
// Grapheme split

export type SpellingSegment = {
  grapheme: string;
  phonemes?: string[];
  patternCode?: string | null;
  patternType?: string | null;
};

export type SegmentKind = "vowel" | "digraph" | "blend" | "ending" | "consonant";

// ARPAbet vowels (incl. r-coloured ER) — a fixed inventory.
const VOWEL_PHONEMES = new Set([
  "AA",
  "AE",
  "AH",
  "AO",
  "AW",
  "AY",
  "EH",
  "ER",
  "EY",
  "IH",
  "IY",
  "OW",
  "OY",
  "UH",
  "UW",
]);
const DIGRAPHS = ["tch", "sh", "ch", "th", "wh", "ph", "ck", "ng", "qu"];
const VOWEL_TEAMS = [
  "igh",
  "ai",
  "ay",
  "ee",
  "ea",
  "oa",
  "ow",
  "oo",
  "ou",
  "oi",
  "oy",
  "ue",
  "ew",
  "ar",
  "er",
  "ir",
  "or",
  "ur",
];
const ENDINGS = ["tion", "sion", "ment", "ness", "less", "ful", "ing", "ed", "es"];

// A rule-based split for when a question carries none (old content, sentence words):
// endings at the end, then the longest digraph / vowel team, else single letters.
export function fallbackSplit(word: string): SpellingSegment[] {
  const w = word.toLowerCase().replace(/[^a-z']/g, "");
  const out: SpellingSegment[] = [];
  const ending = ENDINGS.find((e) => w.length > e.length + 1 && w.endsWith(e));
  const body = ending ? w.slice(0, -ending.length) : w;
  for (let i = 0; i < body.length;) {
    const unit =
      DIGRAPHS.find((d) => body.startsWith(d, i)) ??
      VOWEL_TEAMS.find((v) => body.startsWith(v, i)) ??
      body[i];
    const type = DIGRAPHS.includes(unit)
      ? "consonant_digraph"
      : VOWEL_TEAMS.includes(unit)
        ? "vowel_team"
        : null;
    out.push({ grapheme: unit, patternType: type });
    i += unit.length;
  }
  if (ending) out.push({ grapheme: ending, patternType: ending.length > 3 ? "suffix" : "word_ending" });
  return out;
}

function baseKind(seg: SpellingSegment): SegmentKind {
  const type = seg.patternType ?? "";
  if (type === "word_ending" || type === "suffix") return "ending";
  if (type === "consonant_digraph" || type === "trigraph") return "digraph";
  if (type === "consonant_blend") return "blend";
  if (type === "vowel_team" || type === "r_controlled" || type === "silent_e") return "vowel";
  const phonemes = seg.phonemes;
  if (phonemes && phonemes.length > 0) return VOWEL_PHONEMES.has(phonemes[0]) ? "vowel" : "consonant";
  // A silent e changes the vowel (cake, have); other silent letters are consonants (thumb).
  if (phonemes && phonemes.length === 0) return seg.grapheme === "e" ? "vowel" : "consonant";
  if (/^[aeiou]+$/.test(seg.grapheme)) return "vowel";
  return "consonant";
}

// What each grapheme of a word is, for naming mistakes. Single consonants next to another
// consonant form a cluster (st, fr, nd, mp), so a slip there is a blend error.
export function segmentKinds(split: SpellingSegment[]): SegmentKind[] {
  const kinds = split.map(baseKind);
  return kinds.map((kind, i) => {
    if (kind !== "consonant" || split[i].grapheme.length !== 1) return kind;
    const near = [kinds[i - 1], kinds[i + 1]];
    return near.some((k) => k === "consonant" || k === "blend") &&
      [split[i - 1], split[i + 1]].some(
        (s) => s && s.grapheme.length === 1 && /^[b-df-hj-np-tv-z]$/.test(s.grapheme),
      )
      ? "blend"
      : kind;
  });
}

// ---------------------------------------------------------------------------------------
// Normalisation (no autocorrect)

export function normalizeSpelling(value: string) {
  return value.normalize("NFKC").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

// ---------------------------------------------------------------------------------------
// Letter difference (optimal string alignment: insert, delete, substitute, swap)

export type DiffOp =
  | { op: "keep"; e: string; a: string; at: number }
  | { op: "sub"; e: string; a: string; at: number }
  | { op: "del"; e: string; at: number }
  | { op: "ins"; a: string; at: number }
  | { op: "swap"; e: string; a: string; at: number };

// `at` is the position in the expected word (an insertion goes before expected[at]).
export function diffLetters(expected: string, actual: string): DiffOp[] {
  const e = [...expected];
  const a = [...actual];
  const n = e.length;
  const m = a.length;
  const d = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (e[i - 1] === a[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && e[i - 1] === a[j - 2] && e[i - 2] === a[j - 1] && e[i - 1] !== e[i - 2])
        best = Math.min(best, d[i - 2][j - 2] + 1);
      d[i][j] = best;
    }
  }
  const ops: DiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && e[i - 1] === a[j - 1] && d[i][j] === d[i - 1][j - 1]) {
      ops.push({ op: "keep", e: e[i - 1], a: a[j - 1], at: i - 1 });
      i--;
      j--;
    } else if (
      i > 1 &&
      j > 1 &&
      e[i - 1] === a[j - 2] &&
      e[i - 2] === a[j - 1] &&
      e[i - 1] !== e[i - 2] &&
      d[i][j] === d[i - 2][j - 2] + 1
    ) {
      ops.push({ op: "swap", e: e[i - 2] + e[i - 1], a: a[j - 2] + a[j - 1], at: i - 2 });
      i -= 2;
      j -= 2;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      ops.push({ op: "sub", e: e[i - 1], a: a[j - 1], at: i - 1 });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ op: "del", e: e[i - 1], at: i - 1 });
      i--;
    } else {
      ops.push({ op: "ins", a: a[j - 1], at: i });
      j--;
    }
  }
  return ops.reverse();
}

export function editDistance(ops: DiffOp[]) {
  return ops.filter((o) => o.op !== "keep").length;
}

// ---------------------------------------------------------------------------------------
// Sound-alike key: two spellings with the same key are read the same way by the simple
// sound-spelling rules taught here (kat / cat, fone / phone, bote / boat, burd / bird).

export function soundKey(word: string) {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  // Magic e (a_e, i_e, o_e, u_e, e_e): long vowel, the e is silent.
  w = w.replace(
    /([aeiou])([b-df-hj-np-tv-z])e(s|d)?$/,
    (_, v: string, c: string, s?: string) => `${v.toUpperCase()}${c}${s ?? ""}`,
  );
  const rules: [RegExp, string][] = [
    [/tch/g, "ch"],
    [/dge/g, "j"],
    [/igh/g, "I"],
    [/^kn/, "n"],
    [/^wr/, "r"],
    [/^wh/, "w"],
    [/ph/g, "f"],
    [/ck/g, "k"],
    [/qu/g, "kw"],
    [/ee|ea/g, "E"],
    [/ai|ay/g, "A"],
    [/oa/g, "O"],
    [/oo|ue|ew/g, "U"],
    [/ir|er|ur/g, "R"],
    [/c(?=[eiyEI])/g, "s"],
    [/c/g, "k"],
    [/q/g, "k"],
    [/x/g, "ks"],
    [/z/g, "s"],
    [/([b-df-hj-np-tv-z])\1/g, "$1"],
    [/([b-df-hj-np-tv-z])e$/, "$1"],
  ];
  for (const [pattern, replacement] of rules) w = w.replace(pattern, replacement);
  return w;
}

// ---------------------------------------------------------------------------------------
// Word analysis

export type SpellingFocus = { grapheme: string; position: number; patternCode: string | null };

export type SpellingAnalysis = {
  v: 1;
  kind: "word";
  // The child's answer after normalisation (their raw text is stored separately).
  normalized: string;
  // Typed exactly as expected, including capital letters and spaces.
  exact: boolean;
  correct: boolean;
  distance: number;
  // One category for a wrong answer; null when right.
  category: SpellingErrorCategory | null;
  ops: DiffOp[];
  // The first grapheme the mistake touches, and the phonics pattern it is in.
  focus: SpellingFocus | null;
  // The pattern to review (wrong digraph / blend / vowel / ending only).
  patternCode: string | null;
  almost: boolean;
};

function splitFor(word: string, split: SpellingSegment[] | undefined) {
  const joined = split?.map((s) => s.grapheme).join("") ?? "";
  return split && split.length > 0 && joined === word ? split : fallbackSplit(word);
}

// Which grapheme each letter of the word belongs to.
function letterOwners(split: SpellingSegment[]) {
  const owners: number[] = [];
  split.forEach((s, index) => {
    for (let k = 0; k < s.grapheme.length; k++) owners.push(index);
  });
  return owners;
}

function affectedGraphemes(ops: DiffOp[], expected: string, owners: number[]) {
  const set = new Set<number>();
  const last = owners.length - 1;
  for (const o of ops) {
    if (o.op === "keep") continue;
    if (o.op === "swap") {
      set.add(owners[o.at]);
      set.add(owners[o.at + 1]);
    } else if (o.op === "ins") {
      if (owners.length === 0) continue;
      // An inserted copy of the letter before belongs with it (shipp → the p).
      const before = o.at > 0 ? expected[o.at - 1] : undefined;
      set.add(
        o.at >= owners.length ? owners[last] : before === o.a && o.at > 0 ? owners[o.at - 1] : owners[o.at],
      );
    } else {
      set.add(owners[o.at]);
    }
  }
  return [...set].sort((x, y) => x - y);
}

// A one-letter slip that only doubles or un-doubles a letter (shipp, bel).
function isDoublingSlip(ops: DiffOp[], expected: string) {
  const changes = ops.filter((o) => o.op !== "keep");
  if (changes.length !== 1) return null;
  const c = changes[0];
  if (c.op === "ins" && (expected[c.at - 1] === c.a || expected[c.at] === c.a))
    return "EXTRA_LETTER" as const;
  if (c.op === "del" && (expected[c.at - 1] === c.e || expected[c.at + 1] === c.e))
    return "MISSING_LETTER" as const;
  return null;
}

const KIND_CATEGORY: Partial<Record<SegmentKind, SpellingErrorCategory>> = {
  ending: "WRONG_ENDING",
  digraph: "WRONG_DIGRAPH",
  blend: "WRONG_BLEND",
  vowel: "WRONG_VOWEL",
};

// Classifies a wrong spelling, deterministically, in this order:
//   empty → UNKNOWN; two letters swapped, or all the right letters in another order →
//   TRANSPOSITION; only the irregular part
//   wrong → PHONETIC_APPROXIMATION (sed for said); one doubled / undoubled letter → EXTRA /
//   MISSING_LETTER; same sounds (kat, fone, bote) → PHONETIC_APPROXIMATION; far from the
//   word (more than half its letters changed) → UNKNOWN; every change in one kind of grapheme →
//   WRONG_ENDING / WRONG_DIGRAPH / WRONG_BLEND / WRONG_VOWEL; only deletions / insertions /
//   substitutions → MISSING / EXTRA / SUBSTITUTED_LETTER; otherwise UNKNOWN.
export function analyzeSpelling(args: {
  // Accepted spellings (the first is the main one); compared after normalisation.
  expected: string[];
  actual: string;
  split?: SpellingSegment[];
  // Grapheme positions of the irregular part ("ai" in said = [1]).
  irregularPositions?: number[];
}): SpellingAnalysis {
  const normalized = normalizeSpelling(args.actual);
  const accepted = args.expected.map(normalizeSpelling).filter(Boolean);
  const exact = args.expected.some((e) => e === args.actual);
  if (accepted.includes(normalized)) {
    const target = normalized;
    return {
      v: 1,
      kind: "word",
      normalized,
      exact,
      correct: true,
      distance: 0,
      category: null,
      ops: [...target].map((ch, at) => ({ op: "keep" as const, e: ch, a: ch, at })),
      focus: null,
      patternCode: null,
      almost: false,
    };
  }
  // Compare with the closest accepted spelling (the first on a tie).
  let target = accepted[0] ?? "";
  let ops = diffLetters(target, normalized);
  for (const candidate of accepted.slice(1)) {
    const candidateOps = diffLetters(candidate, normalized);
    if (editDistance(candidateOps) < editDistance(ops)) {
      target = candidate;
      ops = candidateOps;
    }
  }
  const distance = editDistance(ops);
  // The authored split belongs to the main spelling only.
  const split = splitFor(target, target === accepted[0] ? args.split : undefined);
  const owners = letterOwners(split);
  const affected = affectedGraphemes(ops, target, owners);
  const kinds = segmentKinds(split);
  const changes = ops.filter((o) => o.op !== "keep");
  const irregular = new Set(target === accepted[0] ? (args.irregularPositions ?? []) : []);

  const category = ((): SpellingErrorCategory => {
    if (normalized.length === 0) return "UNKNOWN";
    if (changes.length === 1 && changes[0].op === "swap") return "TRANSPOSITION";
    // The right letters, all of them, in the wrong order (pish for ship).
    if ([...normalized].sort().join("") === [...target].sort().join("")) return "TRANSPOSITION";
    if (irregular.size > 0 && affected.length > 0 && affected.every((g) => irregular.has(g)))
      return "PHONETIC_APPROXIMATION";
    const doubling = isDoublingSlip(ops, target);
    if (doubling) return doubling;
    if (soundKey(normalized) === soundKey(target)) return "PHONETIC_APPROXIMATION";
    if (distance > Math.max(1, Math.floor(target.length / 2))) return "UNKNOWN";
    const affectedKinds = new Set(affected.map((g) => kinds[g]));
    if (affectedKinds.size === 1) {
      const byKind = KIND_CATEGORY[[...affectedKinds][0]];
      if (byKind) return byKind;
    }
    if (changes.every((o) => o.op === "del")) return "MISSING_LETTER";
    if (changes.every((o) => o.op === "ins")) return "EXTRA_LETTER";
    if (changes.every((o) => o.op === "sub")) return "SUBSTITUTED_LETTER";
    return "UNKNOWN";
  })();

  const first = affected[0];
  const focus =
    first === undefined
      ? null
      : { grapheme: split[first].grapheme, position: first, patternCode: split[first].patternCode ?? null };
  const reviewable =
    category === "WRONG_DIGRAPH" ||
    category === "WRONG_BLEND" ||
    category === "WRONG_VOWEL" ||
    category === "WRONG_ENDING";
  return {
    v: 1,
    kind: "word",
    normalized,
    exact: false,
    correct: false,
    distance,
    category,
    ops,
    focus,
    patternCode: reviewable ? (focus?.patternCode ?? null) : null,
    almost: distance === 1 || category === "TRANSPOSITION",
  };
}

// The child's answer as cells to show under the word: each letter marked right, wrong or
// extra, and a gap where a letter is missing. Marks are shown with symbols as well as
// colour (✓ / ✗ / + / _).
export type DiffCell = { text: string; mark: "ok" | "wrong" | "extra" | "missing" };

export function diffCells(ops: DiffOp[]): DiffCell[] {
  return ops.flatMap((o): DiffCell[] => {
    switch (o.op) {
      case "keep":
        return [{ text: o.a, mark: "ok" }];
      case "sub":
        return [{ text: o.a, mark: "wrong" }];
      case "swap":
        return [...o.a].map((text) => ({ text, mark: "wrong" as const }));
      case "ins":
        return [{ text: o.a, mark: "extra" }];
      case "del":
        return [{ text: "_", mark: "missing" }];
    }
  });
}

// ---------------------------------------------------------------------------------------
// Sentence dictation

export function sentenceWords(value: string) {
  return normalizeSpelling(value)
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

// The words of a sentence, as compared (case and punctuation aside).
export function canonicalSentence(value: string) {
  return sentenceWords(value).join(" ");
}

export function punctuationCheck(raw: string) {
  const text = raw.trim();
  return { capital: /^[A-Z]/.test(text), end: /[.!?]["')\]]?$/.test(text) };
}

export type SentenceWordResult = {
  status: "ok" | "misspelled" | "missing" | "extra" | "moved";
  expected?: string;
  actual?: string;
  category?: SpellingErrorCategory;
};

export type SentenceAnalysis = {
  v: 1;
  kind: "sentence";
  normalized: string;
  correct: boolean;
  wordsCorrect: boolean;
  punctuation: { required: boolean; capital: boolean; end: boolean };
  words: SentenceWordResult[];
  category: SpellingErrorType | null;
  // The first misspelled word's pattern, for pattern review.
  patternCode: string | null;
  almost: boolean;
};

// Longest common subsequence of two word lists, as index pairs.
function lcsPairs(a: string[], b: string[]) {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (t[i + 1][j] >= t[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

// Word order, missing and extra words, each word's spelling (analyzeSpelling) and basic
// punctuation (a capital letter at the start, . ! or ? at the end — checked only when the
// question asks for it). Deterministic: the same answer always gets the same result.
export function analyzeSentence(args: {
  expected: string;
  actual: string;
  requirePunctuation?: boolean;
  // Grapheme splits of the sentence's words, when known.
  splits?: Record<string, SpellingSegment[]>;
}): SentenceAnalysis {
  const want = sentenceWords(args.expected);
  const got = sentenceWords(args.actual);
  const required = args.requirePunctuation === true;
  const punctuation = { required, ...punctuationCheck(args.actual) };
  const words: SentenceWordResult[] = [];

  const pairs = lcsPairs(want, got);
  let wi = 0;
  let gi = 0;
  const flushGap = (wEnd: number, gEnd: number) => {
    const missing = want.slice(wi, wEnd);
    const extra = got.slice(gi, gEnd);
    const n = Math.max(missing.length, extra.length);
    for (let k = 0; k < n; k++) {
      const e = missing[k];
      const a = extra[k];
      if (e !== undefined && a !== undefined) {
        const analysis = analyzeSpelling({ expected: [e], actual: a, split: args.splits?.[e] });
        // A pair that is nothing alike is a missing word plus an extra one, not a misspelling.
        if (analysis.category === "UNKNOWN") {
          words.push({ status: "missing", expected: e }, { status: "extra", actual: a });
        } else
          words.push({
            status: "misspelled",
            expected: e,
            actual: a,
            category: analysis.category ?? undefined,
          });
      } else if (e !== undefined) words.push({ status: "missing", expected: e });
      else words.push({ status: "extra", actual: a });
    }
    wi = wEnd;
    gi = gEnd;
  };
  for (const [pw, pg] of pairs) {
    flushGap(pw, pg);
    words.push({ status: "ok", expected: want[pw], actual: got[pg] });
    wi = pw + 1;
    gi = pg + 1;
  }
  flushGap(want.length, got.length);

  // A word that is missing in one place and extra in another was moved.
  const missingWords = words.filter((w) => w.status === "missing").map((w) => w.expected!);
  for (const w of words) {
    if (w.status === "extra" && w.actual && missingWords.includes(w.actual)) {
      w.status = "moved";
      const twin = words.find((x) => x.status === "missing" && x.expected === w.actual);
      if (twin) twin.status = "moved";
      missingWords.splice(missingWords.indexOf(w.actual), 1);
    }
  }

  const wordsCorrect = want.join(" ") === got.join(" ");
  const punctuationOk = !required || (punctuation.capital && punctuation.end);
  const sameWords = [...want].sort().join(" ") === [...got].sort().join(" ");
  const firstMisspelled = words.find((w) => w.status === "misspelled");
  const category: SpellingErrorType | null =
    wordsCorrect && punctuationOk
      ? null
      : got.length === 0
        ? "MISSING_WORD"
        : !wordsCorrect && sameWords
          ? "WORD_ORDER"
          : words.some((w) => w.status === "missing")
            ? "MISSING_WORD"
            : words.some((w) => w.status === "extra")
              ? "EXTRA_WORD"
              : words.some((w) => w.status === "moved")
                ? "WORD_ORDER"
                : firstMisspelled
                  ? (firstMisspelled.category ?? "UNKNOWN")
                  : "PUNCTUATION";
  const misspelledPattern = firstMisspelled
    ? analyzeSpelling({
        expected: [firstMisspelled.expected!],
        actual: firstMisspelled.actual!,
        split: args.splits?.[firstMisspelled.expected!],
      }).patternCode
    : null;
  const wrongWords = words.filter((w) => w.status !== "ok").length;
  return {
    v: 1,
    kind: "sentence",
    normalized: got.join(" "),
    correct: wordsCorrect && punctuationOk,
    wordsCorrect,
    punctuation,
    words,
    category,
    patternCode: category && isSpellingErrorType(category) && firstMisspelled ? misspelledPattern : null,
    almost:
      (wordsCorrect && !punctuationOk) || (!wordsCorrect && wrongWords <= 1 && got.length === want.length),
  };
}

// ---------------------------------------------------------------------------------------
// Analysis of a stored answer (server) or a live one (device), by question type.

type AnalysisQuestion =
  | { type: "SPELLING"; content: { speech?: string; split?: SpellingSegment[]; irregular?: number[] } }
  | { type: "WORD_BUILDER"; content: { speech?: string; split?: SpellingSegment[] } }
  | {
      type: "MISSING_LETTER";
      content: { word: string; parts: ({ text: string } | { blank: true })[]; split?: SpellingSegment[] };
    }
  | { type: "SENTENCE_DICTATION"; content: { speech: string } };

export type AnswerAnalysis = SpellingAnalysis | SentenceAnalysis;

// `expected`: the accepted answers on the server; on the device, the spoken word (which a
// listening question has to carry anyway). The verdict always comes from the evaluator /
// answer key; this explains the mistake.
export function analyzeAnswer(
  question: { type: string; content: unknown },
  response: { value?: string; sequence?: string[] },
  options: { expected?: string[]; requirePunctuation?: boolean } = {},
): AnswerAnalysis | null {
  if (!SPELLING_ANALYSIS_TYPES.has(question.type)) return null;
  const q = question as AnalysisQuestion;
  switch (q.type) {
    case "SPELLING": {
      if (typeof response.value !== "string") return null;
      const expected = options.expected ?? (q.content.speech ? [q.content.speech] : []);
      if (expected.length === 0) return null;
      return analyzeSpelling({
        expected,
        actual: response.value,
        split: q.content.split,
        irregularPositions: q.content.irregular,
      });
    }
    case "WORD_BUILDER": {
      if (!Array.isArray(response.sequence)) return null;
      const expected = options.expected ?? (q.content.speech ? [q.content.speech] : []);
      if (expected.length === 0) return null;
      return analyzeSpelling({ expected, actual: response.sequence.join(""), split: q.content.split });
    }
    case "MISSING_LETTER": {
      if (typeof response.value !== "string") return null;
      const actual = q.content.parts.map((p) => ("text" in p ? p.text : response.value)).join("");
      return analyzeSpelling({ expected: [q.content.word], actual, split: q.content.split });
    }
    case "SENTENCE_DICTATION": {
      if (typeof response.value !== "string") return null;
      const expected = options.expected?.[0] ?? q.content.speech;
      return analyzeSentence({
        expected,
        actual: response.value,
        requirePunctuation: options.requirePunctuation,
      });
    }
  }
}

// ---------------------------------------------------------------------------------------
// Hints (generated at import into the question; shown one at a time on request)

export const HINT_KINDS = [
  "listen",
  "listen_slow",
  "sounds",
  "first_sound",
  "letters",
  "pattern",
  "tricky",
  "custom",
] as const;
export type HintKind = (typeof HINT_KINDS)[number];
export type SpellingHint = { kind: HintKind; text: string; speech: string; show?: string };

const spellOut = (letters: string) => [...letters].join(" ");

// Progressive hints, from least to most help (never the whole word):
//   1. listen again   2. say it slowly   3. how many sounds?   (authored hints)
//   4. the tricky part of an irregular word / the pattern / the first letter.
// The player shows them one at a time; how many a child may open is set per activity or
// by the level (spelling rules → maxHints).
export function buildSpellingHints(args: {
  word: string;
  split?: SpellingSegment[];
  focusPattern?: string | null;
  irregularPositions?: number[];
  authored?: { text: string; speech?: string }[];
  max?: number;
}): SpellingHint[] {
  const word = args.word.toLowerCase();
  const split = splitFor(word, args.split);
  const blanks = (shown: (i: number) => boolean) =>
    split.map((s, i) => (shown(i) ? s.grapheme : "_".repeat(s.grapheme.length))).join(" ");
  const known = split.every((s) => s.phonemes !== undefined);
  const sounds = known ? split.filter((s) => (s.phonemes ?? []).length > 0).length : split.length;
  const hints: SpellingHint[] = [
    { kind: "listen", text: "Listen again.", speech: word },
    { kind: "listen_slow", text: "Say it slowly with me.", speech: word },
    {
      kind: "sounds",
      text: `How many sounds do you hear? ${sounds}.`,
      speech: `How many sounds do you hear? It has ${sounds} ${sounds === 1 ? "sound" : "sounds"}.`,
      show: Array.from({ length: sounds }, () => "●").join(" "),
    },
  ];
  // An authored hint takes the place of plain "listen again" (the Listen button does that).
  if ((args.authored ?? []).length > 0) hints.shift();
  for (const h of args.authored ?? [])
    hints.push({ kind: "custom", text: h.text, speech: h.speech ?? h.text });
  const irregular = (args.irregularPositions ?? []).filter((p) => p >= 0 && p < split.length);
  const focusIndex = args.focusPattern ? split.findIndex((s) => s.patternCode === args.focusPattern) : -1;
  if (irregular.length > 0) {
    const part = irregular.map((p) => split[p].grapheme).join("");
    hints.push({
      kind: "tricky",
      text: `Tricky part: “${part}”.`,
      speech: `The tricky part is spelled ${spellOut(part)}.`,
      show: blanks((i) => irregular.includes(i)),
    });
  } else if (focusIndex >= 0 && split[focusIndex].grapheme.length > 1) {
    const g = split[focusIndex].grapheme;
    hints.push({
      kind: "pattern",
      text: `Look for “${g}”. ${g.length} letters, one sound.`,
      speech: `This word has ${spellOut(g)} in it.`,
      show: blanks((i) => i === focusIndex),
    });
  } else {
    const first = split[0]?.grapheme ?? word[0];
    hints.push({
      kind: "first_sound",
      text: `It starts with “${first}”.`,
      speech: `It starts with ${spellOut(first)}.`,
      show: blanks((i) => i === 0),
    });
  }
  return hints.slice(0, Math.max(0, args.max ?? hints.length));
}

// ---------------------------------------------------------------------------------------
// Per-step settings: activity config first, then the level's spelling rules.

export type SpellingStepSettings = {
  activity: SpellingActivity | null;
  input: InputMethod;
  // Plays allowed (null = no limit) and whether "Slow" is offered — dictation.
  replayLimit: number | null;
  slowReplay: boolean;
  maxHints: number;
};

export function resolveSpellingSettings(args: {
  config: { input?: InputMethod; replayLimit?: number; slowReplay?: boolean; maxHints?: number };
  levelCode: string | null;
  activity: SpellingActivity | null;
  rules?: LearningRules;
}): SpellingStepSettings {
  const rules = (args.rules ?? DEFAULT_RULES).spelling;
  const level = (args.levelCode && rules.levels[args.levelCode]) || rules.levels[rules.defaultLevel];
  const dictation = args.activity === "DICTATION" || args.activity === "SENTENCE_DICTATION";
  return {
    activity: args.activity,
    input: args.config.input ?? (args.activity === "SENTENCE_DICTATION" ? "KEYBOARD" : level.inputMethod),
    replayLimit: args.config.replayLimit ?? (dictation ? level.dictationReplayLimit : null),
    slowReplay: args.config.slowReplay ?? (dictation ? level.slowReplay : true),
    maxHints: args.config.maxHints ?? (dictation ? Math.min(2, level.maxHints) : level.maxHints),
  };
}

// ---------------------------------------------------------------------------------------
// Spelling mastery and review

export type SpellingAttempt = {
  id?: string;
  isCorrect: boolean;
  hintsUsed: number;
  attemptedAt: string;
  errorType: string | null;
};

export type SpellingProgressResult = {
  attempts: number;
  correct: number;
  hinted: number;
  accuracy: number;
  status: MasteryStatus;
  masteryScore: number;
  practiceDays: number;
  reviewPriority: number;
  nextReviewAt: string | null;
  firstPracticedAt: string | null;
  lastPracticedAt: string | null;
  lastErrorType: string | null;
  errorCounts: Record<string, number>;
};

// Independent spelling: right on the first try, and (by default) without a hint.
export function isIndependent(
  a: Pick<SpellingAttempt, "isCorrect" | "hintsUsed">,
  rules: LearningRules = DEFAULT_RULES,
) {
  return a.isCorrect && (!rules.spelling.requireIndependent || a.hintsUsed === 0);
}

// One word's spelling progress from its spelling first tries (any order): the skill mastery
// algorithm with the spelling evidence target. Vocabulary mastery of the word is separate.
export function computeSpellingProgress(
  attempts: SpellingAttempt[],
  options: { now: Date; timeZone?: string; rules?: LearningRules },
): SpellingProgressResult {
  const rules = options.rules ?? DEFAULT_RULES;
  const mastery = computeMastery(
    {
      attempts: attempts.map((a) => ({
        id: a.id,
        isCorrect: isIndependent(a, rules),
        attemptedAt: a.attemptedAt,
      })),
      masteryThreshold: 0,
      importance: 3,
      now: options.now,
      timeZone: options.timeZone,
    },
    { ...rules.mastery, fullEvidenceAttempts: rules.spelling.fullEvidenceAttempts },
  );
  const errorCounts: Record<string, number> = {};
  for (const a of attempts)
    if (!a.isCorrect && a.errorType) errorCounts[a.errorType] = (errorCounts[a.errorType] ?? 0) + 1;
  const sorted = [...attempts].sort(
    (x, y) => y.attemptedAt.localeCompare(x.attemptedAt) || ((x.id ?? "") < (y.id ?? "") ? 1 : -1),
  );
  return {
    attempts: mastery.attempts,
    correct: mastery.correctAttempts,
    hinted: attempts.filter((a) => a.isCorrect && a.hintsUsed > 0).length,
    accuracy: mastery.accuracy,
    status: mastery.status,
    masteryScore: mastery.masteryScore,
    practiceDays: mastery.practiceDays,
    reviewPriority: mastery.reviewPriority,
    nextReviewAt: mastery.nextReviewAt?.toISOString() ?? null,
    firstPracticedAt: sorted.at(-1)?.attemptedAt ?? null,
    lastPracticedAt: mastery.lastPracticedAt?.toISOString() ?? null,
    lastErrorType: sorted.find((a) => !a.isCorrect)?.errorType ?? null,
    errorCounts,
  };
}

export const spellingKey = (wordId: string) => `spelling:${wordId}`;
export const patternKey = (patternId: string) => `pattern:${patternId}`;

const DAY_MS = 24 * 60 * 60 * 1000;

// One open spelling item per word (spelling:<id>):
//   * missed_spelling — the latest spelling first try (within the lookback) was wrong;
//   * weak_spelling   — enough answers and accuracy below the bar;
//   * due_review      — practised, not yet mastered, at its next review date.
export function deriveSpellingReview(
  word: {
    wordId: string;
    skillId: string | null;
    lessonId: string | null;
    attempts: { isCorrect: boolean; attemptedAt: string }[];
    progress: Pick<
      SpellingProgressResult,
      "attempts" | "accuracy" | "reviewPriority" | "nextReviewAt" | "status"
    >;
  },
  now: Date,
  rules: LearningRules = DEFAULT_RULES,
): ReviewItemRow | null {
  if (word.attempts.length === 0) return null;
  const latest = [...word.attempts].sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt));
  const since = now.getTime() - rules.review.missedWordLookbackDays * DAY_MS;
  const recent = latest.filter((a) => Date.parse(a.attemptedAt) >= since);
  const missed = recent.length > 0 && !recent[0].isCorrect;
  const weak =
    word.progress.attempts >= rules.spelling.minAttempts &&
    word.progress.accuracy < rules.spelling.weakBelowAccuracy;
  const scheduled = word.progress.status !== "MASTERED" && word.progress.nextReviewAt !== null;
  if (!missed && !weak && !scheduled) return null;
  const misses = recent.filter((a) => !a.isCorrect).length;
  const reason = missed ? "missed_spelling" : weak ? "weak_spelling" : "due_review";
  const priority =
    reason === "missed_spelling"
      ? Math.min(100, 45 + 15 * misses)
      : reason === "weak_spelling"
        ? Math.min(100, Math.max(50, word.progress.reviewPriority))
        : word.progress.reviewPriority;
  return {
    item_key: spellingKey(word.wordId),
    skill_id: word.skillId,
    word_id: word.wordId,
    phonics_pattern_id: null,
    lesson_id: word.lessonId,
    priority: Math.round(priority * 100) / 100,
    due_at: reason === "due_review" ? word.progress.nextReviewAt! : now.toISOString(),
    reason,
    status: "open",
    resolved_at: null,
  };
}

// A phonics pattern the child keeps misspelling (ship → sip, chop → shop …) comes back as
// one review item for the pattern (pattern:<id>) — however many words showed it — pointing
// at the pattern's phonics lesson. Open while there are at least `patternErrorsForReview`
// errors in the lookback and fewer than two right spellings of words with that focus pattern
// since the latest error.
export function derivePatternReview(
  pattern: {
    patternId: string;
    skillId: string | null;
    lessonId: string | null;
    errorTimes: string[];
    correctSinceLastError: number;
  },
  now: Date,
  rules: LearningRules = DEFAULT_RULES,
): ReviewItemRow | null {
  const since = now.getTime() - rules.spelling.patternLookbackDays * DAY_MS;
  const recent = pattern.errorTimes.filter((t) => Date.parse(t) >= since);
  if (recent.length < rules.spelling.patternErrorsForReview || pattern.correctSinceLastError >= 2)
    return null;
  return {
    item_key: patternKey(pattern.patternId),
    skill_id: pattern.skillId,
    word_id: null,
    phonics_pattern_id: pattern.patternId,
    lesson_id: pattern.lessonId,
    priority: Math.min(100, 40 + 10 * recent.length),
    due_at: now.toISOString(),
    reason: "spelling_pattern",
    status: "open",
    resolved_at: null,
  };
}

// ---------------------------------------------------------------------------------------
// Parent summary

export type SpellingWordFact = {
  wordId: string;
  word: string;
  emoji: string;
  spellingType: string;
  status: MasteryStatus;
  attempts: number;
  correct: number;
  hinted: number;
  accuracy: number;
  lastErrorType: string | null;
  lastPracticedAt: string | null;
  familyCodes: string[];
};

export type SpellingSummary = {
  wordsPracticed: number;
  wordsMastered: number;
  byStatus: Record<MasteryStatus, number>;
  firstTryAccuracy: number;
  hintedAnswers: number;
  errors: { category: SpellingErrorType; attempts: number; share: number }[];
  types: { code: string; practiced: number; mastered: number; accuracy: number }[];
  families: { code: string; practiced: number; accuracy: number }[];
  weakWords: SpellingWordFact[];
  recent: SpellingWordFact[];
};

const pct = (correct: number, total: number) => (total ? Math.round((10000 * correct) / total) / 100 : 0);

export function summarizeSpelling(
  words: SpellingWordFact[],
  errorCounts: { errorType: string; attempts: number }[],
  rules: LearningRules = DEFAULT_RULES,
): SpellingSummary {
  const practiced = words.filter((w) => w.attempts > 0);
  const byStatus = {
    NOT_STARTED: 0,
    LEARNING: 0,
    PRACTICING: 0,
    ALMOST_MASTERED: 0,
    MASTERED: 0,
  } satisfies Record<MasteryStatus, number>;
  for (const w of practiced) byStatus[w.status] += 1;
  const totalAttempts = practiced.reduce((n, w) => n + w.attempts, 0);
  const totalCorrect = practiced.reduce((n, w) => n + w.correct, 0);
  const errorsTotal = errorCounts.reduce((n, e) => n + e.attempts, 0);
  const errors = errorCounts
    .filter((e) => isSpellingErrorType(e.errorType) && e.attempts > 0)
    .map((e) => ({
      category: e.errorType as SpellingErrorType,
      attempts: e.attempts,
      share: pct(e.attempts, errorsTotal),
    }))
    .sort((a, b) => b.attempts - a.attempts || a.category.localeCompare(b.category));
  const group = (keyOf: (w: SpellingWordFact) => string[]) => {
    const map = new Map<string, SpellingWordFact[]>();
    for (const w of practiced) for (const k of keyOf(w)) map.set(k, [...(map.get(k) ?? []), w]);
    return [...map].map(([code, list]) => ({
      code,
      practiced: list.length,
      mastered: list.filter((w) => w.status === "MASTERED").length,
      accuracy: pct(
        list.reduce((n, w) => n + w.correct, 0),
        list.reduce((n, w) => n + w.attempts, 0),
      ),
    }));
  };
  return {
    wordsPracticed: practiced.length,
    wordsMastered: byStatus.MASTERED,
    byStatus,
    firstTryAccuracy: pct(totalCorrect, totalAttempts),
    hintedAnswers: practiced.reduce((n, w) => n + w.hinted, 0),
    errors,
    types: group((w) => [w.spellingType]).sort(
      (a, b) => b.practiced - a.practiced || a.code.localeCompare(b.code),
    ),
    families: group((w) => w.familyCodes)
      .map(({ code, practiced: p, accuracy }) => ({ code, practiced: p, accuracy }))
      .sort((a, b) => b.practiced - a.practiced || a.code.localeCompare(b.code)),
    weakWords: practiced
      .filter(
        (w) => w.attempts >= rules.spelling.minAttempts && w.accuracy < rules.spelling.weakBelowAccuracy,
      )
      .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
      .slice(0, 10),
    recent: practiced
      .filter((w) => w.lastPracticedAt)
      .sort((a, b) => (b.lastPracticedAt ?? "").localeCompare(a.lastPracticedAt ?? ""))
      .slice(0, 10),
  };
}

// Improvement over time for parents: first-try spelling accuracy per week (the latest
// `weeks` weeks, oldest first) and the average answer time.
export function spellingTrend(
  attempts: { isCorrect: boolean; responseTimeMs: number; attemptedAt: string }[],
  now: Date,
  weeks = 4,
) {
  const WEEK = 7 * DAY_MS;
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    weeksAgo: weeks - 1 - i,
    attempts: 0,
    correct: 0,
    accuracy: 0,
  }));
  const inWindow: typeof attempts = [];
  for (const a of attempts) {
    const ago = Math.floor((now.getTime() - Date.parse(a.attemptedAt)) / WEEK);
    const bucket = buckets.find((b) => b.weeksAgo === ago);
    if (!bucket) continue;
    inWindow.push(a);
    bucket.attempts += 1;
    if (a.isCorrect) bucket.correct += 1;
  }
  for (const b of buckets) b.accuracy = pct(b.correct, b.attempts);
  const timed = inWindow.filter((a) => a.responseTimeMs > 0);
  const averageResponseMs = timed.length
    ? Math.round(timed.reduce((n, a) => n + a.responseTimeMs, 0) / timed.length)
    : null;
  const withData = buckets.filter((b) => b.attempts > 0);
  const change =
    withData.length >= 2 ? Math.round((withData.at(-1)!.accuracy - withData[0].accuracy) * 100) / 100 : null;
  return { weeks: buckets, averageResponseMs, change };
}
