import { z } from "zod";
import type { MechanicMode, WritingLevelRules, WritingMechanic, WritingRules } from "@/lib/learning/rules";
import { DEFAULT_RULES } from "@/lib/learning/rules";
import type { ReviewItemRow } from "@/lib/learning/review-queue";
import { analyzeSentence, canonicalSentence } from "@/lib/learning/spelling";

// Typed writing (Phase 8): copying, finishing, building, editing and composing sentences and
// short texts. Pure functions shared by the device (instant feedback from a digest-only
// answer key) and the server (the stored verdict). Handwriting is tracing.ts.
//
// What is checked, and how:
//   * Closed tasks (copy a sentence, finish one, correct one) compare the child's text with
//     the accepted answers word by word (case, end marks and spaces are mechanics, below).
//   * Open-ended tasks (write about a dog, a guided paragraph) are never compared with a
//     stored sentence. A rubric of deterministic checks decides: enough words and sentences,
//     the required ideas (keyword groups, any one of several forms), sequence words, a
//     topic sentence, mechanics. Critical criteria decide right or not yet; minor ones are
//     feedback. These checks do not understand meaning: "The dog is big." and "Big is the
//     dog dog." both mention a dog. Parents see the child's own text next to the checks.
//   * Mechanics (capital letters, end marks, spaces between words, spelling of known words)
//     are judged per level (rules.writing.levels): off, a hint, or required.

export type MechanicsSettings = Record<WritingMechanic, MechanicMode>;

export function writingLevelRules(
  levelCode: string | null,
  rules: WritingRules = DEFAULT_RULES.writing,
): WritingLevelRules {
  return rules.levels[levelCode ?? ""] ?? rules.levels[rules.defaultLevel] ?? Object.values(rules.levels)[0];
}

// ---- text helpers --------------------------------------------------------------------------

export function normalizeWritingText(value: string) {
  return value.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

// Words as a child wrote them (letters, digits, apostrophes), lower-cased.
export function writtenWords(value: string): string[] {
  return (
    normalizeWritingText(value)
      .toLowerCase()
      .match(/[\p{L}\p{N}']+/gu) ?? []
  )
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

// Sentences: split after . ! ? (or a line break); a trailing fragment counts as a sentence.
export function writtenSentences(value: string): string[] {
  return normalizeWritingText(value)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

// The form a keyword is compared in: lower case, letters/digits/apostrophes, single spaces.
export function canonicalPhrase(value: string) {
  return writtenWords(value).join(" ");
}

// Every 1-, 2- and 3-word sequence of a text (keywords may be short phrases: "ice cream").
export function phrasesOf(value: string): string[] {
  const words = writtenWords(value);
  const out = new Set<string>();
  for (let n = 1; n <= 3; n++)
    for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return [...out];
}

function editDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[a.length][b.length];
}

// ---- mechanics -----------------------------------------------------------------------------

export type SpacingIssue =
  | { kind: "joined"; written: string; words: string[] }
  | { kind: "split"; written: string[]; word: string }
  | { kind: "extra_space" };

export type MechanicsReport = {
  // Sentences that start without a capital letter, and a lone "i".
  capitalization: { ok: boolean; sentencesMissing: number; lowercaseI: boolean };
  // Sentences (or lines) that do not end with . ! or ?
  punctuation: { ok: boolean; missingEnd: number };
  spacing: { ok: boolean; issues: SpacingIssue[] };
};

// `units`: each line is a sentence or more (guided frames, paragraph parts); `words`: the
// words the text should contain or may contain (expected words of a copy, or the known word
// list) — used to tell "catis" (cat + is) and "be cause" (because) apart from misspellings.
export function analyzeMechanics(units: string[], words: Iterable<string> = []): MechanicsReport {
  const known = new Set([...words].map((w) => w.toLowerCase()));
  let sentencesMissing = 0;
  let missingEnd = 0;
  let lowercaseI = false;
  const spacing: SpacingIssue[] = [];
  for (const unit of units) {
    const text = normalizeWritingText(unit).trim();
    if (!text) continue;
    const sentences = writtenSentences(text);
    for (const s of sentences) if (!/^["'(]*\p{Lu}/u.test(s) && /^["'(]*\p{Ll}/u.test(s)) sentencesMissing++;
    if (/(^|[^\p{L}'])i([^\p{L}']|$)/u.test(text)) lowercaseI = true;
    if (!/[.!?]["')\]]?$/.test(text)) missingEnd++;
    if (/\S {2,}\S/.test(text) || /\s+[.,!?]/.test(text)) spacing.push({ kind: "extra_space" });
    if (known.size > 0) {
      const tokens = writtenWords(text);
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (!known.has(t)) {
          for (let cut = 1; cut < t.length; cut++) {
            const [a, b] = [t.slice(0, cut), t.slice(cut)];
            if (known.has(a) && known.has(b) && (a.length > 1 || a === "a" || a === "i")) {
              spacing.push({ kind: "joined", written: t, words: [a, b] });
              break;
            }
          }
        }
        const next = tokens[i + 1];
        if (next && (!known.has(t) || !known.has(next)) && known.has(t + next)) {
          spacing.push({ kind: "split", written: [t, next], word: t + next });
          i++;
        }
      }
    }
  }
  return {
    capitalization: { ok: sentencesMissing === 0 && !lowercaseI, sentencesMissing, lowercaseI },
    punctuation: { ok: missingEnd === 0, missingEnd },
    spacing: { ok: spacing.length === 0, issues: spacing },
  };
}

// Words run together or split apart; an extra space alone is only pointed out.
export function spacingMet(report: MechanicsReport) {
  return !report.spacing.issues.some((i) => i.kind !== "extra_space");
}

// ---- results ---------------------------------------------------------------------------------

export type WritingErrorType =
  | "CAPITALIZATION"
  | "PUNCTUATION"
  | "SPACING"
  | "WRITING_TOO_SHORT"
  | "WRITING_SENTENCES"
  | "WRITING_CONTENT"
  | "WRITING_SEQUENCE"
  | "WRITING_STRUCTURE"
  | "WRITING_COPIED"
  | "WRITING_TOPIC"
  | "WRITING_ENDING"
  | "WRITING_INCOMPLETE"
  | "WRITING_ORDER"
  | "WRITING_WORDS"
  | "EDIT_NOT_FIXED"
  | "MISSING_WORD"
  | "EXTRA_WORD"
  | "WORD_ORDER"
  | "MISSPELLED";

// One check of a written answer, as shown to the child and the parent (no answers in it).
export type CriterionResult = {
  id: string;
  dimension: string;
  label: string;
  hint: string;
  critical: boolean;
  // null: could not be checked (e.g. spelling of words outside the word list).
  met: boolean | null;
  detail?: string;
};

export type WritingVerdict = {
  isCorrect: boolean;
  almost: boolean;
  errorType: WritingErrorType | null;
  analysis: WritingAnalysis;
};

export type WritingAnalysis = {
  v: 1;
  kind: "copy" | "complete" | "edit" | "rubric" | "story" | "trace";
  criteria: CriterionResult[];
  words: number;
  sentences: number;
  mechanics?: MechanicsReport;
  // Spelling of known words in open-ended writing (server only): words that look like a
  // misspelling of a word-bank word, and how many words could not be checked.
  spelling?: { misspelled: { written: string; suggestion: string }[]; unchecked: number };
  // Closed tasks: how close the words were.
  wordAnalysis?: { category: string | null; almost: boolean };
  edit?: { fixesNeeded: number; fixesMade: number };
  // Handwriting: how the letter was made (drawn or typed) and what the tracing engine measured.
  trace?: {
    glyph: string;
    method: "draw" | "typed";
    mode: string;
    coverage?: number;
    precision?: number;
    orderOk?: boolean;
    directionOk?: boolean;
    startOk?: boolean;
    strokes?: number;
  };
  // Story writing: the order was right.
  orderOk?: boolean;
};

const MECHANIC_LABELS: Record<
  Exclude<WritingMechanic, "spelling">,
  { label: string; hint: string; error: WritingErrorType }
> = {
  capitalization: {
    label: "Capital letter",
    hint: "Start each sentence with a capital letter.",
    error: "CAPITALIZATION",
  },
  punctuation: { label: "End mark", hint: "End each sentence with . ! or ?", error: "PUNCTUATION" },
  spacing: { label: "Spaces", hint: "Leave a space between words.", error: "SPACING" },
};

function mechanicCriteria(report: MechanicsReport, settings: MechanicsSettings): CriterionResult[] {
  const out: CriterionResult[] = [];
  for (const m of ["capitalization", "punctuation", "spacing"] as const) {
    if (settings[m] === "off") continue;
    const met = m === "spacing" ? spacingMet(report) : report[m].ok;
    out.push({
      id: m,
      dimension: m,
      label: MECHANIC_LABELS[m].label,
      hint: MECHANIC_LABELS[m].hint,
      critical: settings[m] === "required",
      met,
    });
  }
  return out;
}

function verdictFrom(
  criteria: CriterionResult[],
  analysis: WritingAnalysis,
  errors: Record<string, WritingErrorType>,
): WritingVerdict {
  const critical = criteria.filter((c) => c.critical);
  const failed = critical.filter((c) => c.met === false);
  const isCorrect = failed.length === 0;
  const met = critical.length - failed.length;
  return {
    isCorrect,
    almost: !isCorrect && critical.length >= 2 && met >= Math.ceil(critical.length / 2) && analysis.words > 0,
    errorType: isCorrect ? null : (errors[failed[0].id] ?? errors[failed[0].dimension] ?? "WRITING_CONTENT"),
    analysis: { ...analysis, criteria },
  };
}

// ---- closed tasks ----------------------------------------------------------------------------

// Copying a sentence (or writing a dictated one): the words must be the sentence's words;
// capital letter, end mark and spaces as the level asks. A spacing-only slip ("The catis
// big.") is a spacing issue, not a wrong word.
export function evaluateCopy(args: {
  accepted: string[];
  actual: string;
  mechanics: MechanicsSettings;
}): WritingVerdict {
  const accepted = args.accepted.map((a) => canonicalSentence(a));
  const given = canonicalSentence(args.actual);
  const wordsRight = accepted.includes(given);
  const spacingOnly =
    !wordsRight && given.length > 0 && accepted.some((a) => compactWords(a) === compactWords(given));
  const words = analyzeSentence({ expected: args.accepted[0], actual: args.actual });
  return copyVerdict({
    actual: args.actual,
    expectedWords: [...new Set(args.accepted.flatMap(writtenWords))],
    wordsRight,
    spacingOnly,
    mechanics: args.mechanics,
    wordCategory: (words.category as WritingErrorType | null) ?? null,
    wordAlmost: words.almost,
  });
}

// A sentence's words with the spaces taken out ("the catis big" → "thecatisbig").
export function compactWords(value: string) {
  return canonicalSentence(value).replace(/\s+/g, "");
}

// The verdict of a copy from what was found: shared by the server (plain answers) and the
// device (digests), so both decide the same way.
export function copyVerdict(args: {
  actual: string;
  expectedWords: string[];
  wordsRight: boolean;
  spacingOnly: boolean;
  mechanics: MechanicsSettings;
  wordCategory: WritingErrorType | null;
  wordAlmost: boolean;
}): WritingVerdict {
  const { wordsRight, spacingOnly } = args;
  const mechanics = analyzeMechanics([args.actual], args.expectedWords);
  if (spacingOnly && spacingMet(mechanics))
    mechanics.spacing = {
      ok: false,
      issues: [
        ...mechanics.spacing.issues,
        { kind: "joined", written: canonicalSentence(args.actual), words: args.expectedWords },
      ],
    };
  const criteria: CriterionResult[] = [
    {
      id: "words",
      dimension: "words",
      label: "The right words",
      hint: "Write every word of the sentence.",
      critical: true,
      met: wordsRight || (spacingOnly && args.mechanics.spacing !== "required"),
    },
    ...mechanicCriteria(mechanics, args.mechanics),
  ];
  if (spacingOnly && args.mechanics.spacing === "off")
    criteria.push({
      ...MECHANIC_LABELS.spacing,
      id: "spacing",
      dimension: "spacing",
      critical: false,
      met: false,
    });
  return verdictFrom(
    criteria,
    {
      v: 1,
      kind: "copy",
      criteria,
      words: writtenWords(args.actual).length,
      sentences: writtenSentences(args.actual).length,
      mechanics,
      wordAnalysis: {
        category: wordsRight ? null : spacingOnly ? "SPACING" : args.wordCategory,
        almost: args.wordAlmost,
      },
    },
    {
      words: spacingOnly ? "SPACING" : (args.wordCategory ?? "WRITING_WORDS"),
      capitalization: "CAPITALIZATION",
      punctuation: "PUNCTUATION",
      spacing: "SPACING",
    },
  );
}

// Finishing a sentence: the missing word(s), any accepted form. Case and end marks are not
// what is being tested.
export function canonicalCompletion(value: string) {
  return writtenWords(value).join(" ");
}

export function evaluateCompletion(args: { accepted: string[]; actual: string }): WritingVerdict {
  const given = canonicalCompletion(args.actual);
  const ok = args.accepted.some((a) => canonicalCompletion(a) === given);
  const close =
    !ok &&
    given.length > 0 &&
    args.accepted.some((a) => editDistance(canonicalCompletion(a), given) <= (given.length > 4 ? 2 : 1));
  const criteria: CriterionResult[] = [
    {
      id: "words",
      dimension: "words",
      label: "A word that fits",
      hint: "Write a word that finishes the sentence.",
      critical: true,
      met: ok,
    },
  ];
  return {
    isCorrect: ok,
    almost: close,
    errorType: ok ? null : close ? "MISSPELLED" : "WRITING_WORDS",
    analysis: { v: 1, kind: "complete", criteria, words: writtenWords(args.actual).length, sentences: 0 },
  };
}

// Correcting a sentence: exactly one of the accepted corrections (spaces collapsed; case and
// punctuation matter — they are usually the point).
export function canonicalEdit(value: string) {
  return normalizeWritingText(value)
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}

function tokens(value: string) {
  return canonicalEdit(value).split(" ").filter(Boolean);
}

// Longest common subsequence pairs of two token lists.
function lcs(a: string[], b: string[]): [number, number][] {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs: [number, number][] = [];
  let [i, j] = [0, 0];
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

export type EditFixKind = "capitalization" | "punctuation" | "spelling" | "word";

// The changes that turn `original` into `target`: each target word not shared with the
// original, classified by what kind of fix it is.
export function editFixes(original: string, target: string): { tokens: number[]; kind: EditFixKind }[] {
  const o = tokens(original);
  const t = tokens(target);
  const kept = new Set(lcs(o, t).map(([, j]) => j));
  // One fix per changed word: "My friend" for "my frend" is a capital and a spelling.
  const runs: number[][] = [];
  t.forEach((_, j) => {
    if (!kept.has(j)) runs.push([j]);
  });
  return runs.map((run) => {
    const want = run.map((j) => t[j]).join(" ");
    const near = o.find((w) => w.toLowerCase() === want.toLowerCase());
    const bare = (s: string) => s.replace(/[^\p{L}\p{N}' ]/gu, "").toLowerCase();
    const kind: EditFixKind =
      near !== undefined
        ? "capitalization"
        : o.some((w) => bare(w) === bare(want))
          ? "punctuation"
          : o.some((w) => editDistance(bare(w), bare(want)) <= 2 && bare(w).length > 2)
            ? "spelling"
            : "word";
    return { tokens: run, kind };
  });
}

export function evaluateEdit(args: { original: string; accepted: string[]; actual: string }): WritingVerdict {
  const given = canonicalEdit(args.actual);
  const exact = args.accepted.some((a) => canonicalEdit(a) === given);
  const target = args.accepted[0];
  const fixes = editFixes(args.original, target);
  const kept = new Set(lcs(tokens(args.actual), tokens(target)).map(([, j]) => j));
  const made = fixes.filter((f) => f.tokens.every((j) => kept.has(j)));
  const remaining = fixes.filter((f) => !made.includes(f));
  const unchanged = canonicalEdit(args.original) === given;
  const criteria: CriterionResult[] = fixes.map((f, i) => ({
    id: `fix-${i + 1}`,
    dimension: f.kind,
    label: {
      capitalization: "Fix a capital letter",
      punctuation: "Fix an end mark",
      spelling: "Fix a spelling",
      word: "Fix a word",
    }[f.kind],
    hint: {
      capitalization: "Look at the capital letters.",
      punctuation: "Look at the end of the sentence.",
      spelling: "Check how each word is spelled.",
      word: "Does every word sound right?",
    }[f.kind],
    critical: true,
    met: exact || made.includes(f),
  }));
  const errorByKind: Record<EditFixKind, WritingErrorType> = {
    capitalization: "CAPITALIZATION",
    punctuation: "PUNCTUATION",
    spelling: "MISSPELLED",
    word: "EDIT_NOT_FIXED",
  };
  // Near miss: the words are right and only capitals or end marks are not (the device can
  // tell this from its key, so both decide the same way), and the child changed something.
  const wordsRight = args.accepted.some((a) => canonicalSentence(a) === canonicalSentence(args.actual));
  return {
    isCorrect: exact,
    almost: !exact && !unchanged && wordsRight,
    errorType: exact ? null : remaining[0] ? errorByKind[remaining[0].kind] : "EDIT_NOT_FIXED",
    analysis: {
      v: 1,
      kind: "edit",
      criteria,
      words: writtenWords(args.actual).length,
      sentences: writtenSentences(args.actual).length,
      edit: { fixesNeeded: fixes.length, fixesMade: exact ? fixes.length : made.length },
    },
  };
}

// ---- open-ended writing: rubrics ---------------------------------------------------------

export const RUBRIC_DIMENSIONS = [
  "words",
  "sentences",
  "keywords",
  "capitalization",
  "punctuation",
  "spacing",
  "spelling",
  "sequence_words",
  "structure",
  "not_copied",
  "topic_sentence",
  "ending",
  "lines_filled",
] as const;
export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

const keywordGroups = z
  .array(z.array(z.string().trim().min(1).max(40)).min(1).max(16))
  .min(1)
  .max(8);
const criterionBase = {
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  label: z.string().trim().min(1).max(80),
  hint: z.string().trim().max(160).default(""),
  weight: z.number().int().min(1).max(3).default(1),
};
const critical = z.boolean().default(true);
// Mechanics follow the level unless the rubric fixes them.
const mechanicCritical = z.union([z.boolean(), z.literal("level")]).default("level");

export const rubricCriterionSchema = z.discriminatedUnion("dimension", [
  z.object({
    ...criterionBase,
    dimension: z.literal("words"),
    critical,
    min: z.number().int().min(1).max(300),
    max: z.number().int().min(1).max(400).optional(),
  }),
  z.object({
    ...criterionBase,
    dimension: z.literal("sentences"),
    critical,
    min: z.number().int().min(1).max(20),
    max: z.number().int().min(1).max(30).optional(),
  }),
  // Required ideas: each group is one idea in any of its forms ("dog", "dogs", "puppy");
  // `min` groups must appear (default: all).
  z.object({
    ...criterionBase,
    dimension: z.literal("keywords"),
    critical,
    groups: keywordGroups,
    min: z.number().int().min(1).max(8).optional(),
  }),
  z.object({ ...criterionBase, dimension: z.literal("capitalization"), critical: mechanicCritical }),
  z.object({ ...criterionBase, dimension: z.literal("punctuation"), critical: mechanicCritical }),
  z.object({ ...criterionBase, dimension: z.literal("spacing"), critical: mechanicCritical }),
  // Spelling of words the app knows; words outside the word list are not judged, so this is
  // never critical in open-ended writing.
  z.object({ ...criterionBase, dimension: z.literal("spelling"), critical: z.literal(false).default(false) }),
  z.object({
    ...criterionBase,
    dimension: z.literal("sequence_words"),
    critical,
    min: z.number().int().min(1).max(6),
    words: z.array(z.string().trim().min(1).max(20)).min(1).max(20).optional(),
  }),
  // Each sentence has at least this many words (default: the level's minimum).
  z.object({
    ...criterionBase,
    dimension: z.literal("structure"),
    critical,
    minWordsPerSentence: z.number().int().min(1).max(12).optional(),
  }),
  // The child wrote more than the given text (a starter or the prompt) back.
  z.object({
    ...criterionBase,
    dimension: z.literal("not_copied"),
    critical,
    text: z.string().trim().min(1).max(300),
  }),
  // The first sentence names the topic.
  z.object({ ...criterionBase, dimension: z.literal("topic_sentence"), critical, groups: keywordGroups }),
  // A closing sentence: at least `minSentences`, and a last sentence of 3+ words.
  z.object({
    ...criterionBase,
    dimension: z.literal("ending"),
    critical,
    minSentences: z.number().int().min(2).max(10).default(3),
  }),
  // Guided frames / paragraph parts: at least `min` of the boxes filled in.
  z.object({
    ...criterionBase,
    dimension: z.literal("lines_filled"),
    critical,
    min: z.number().int().min(1).max(10),
  }),
]);
export type RubricCriterion = z.infer<typeof rubricCriterionSchema>;
export const rubricCriteriaSchema = z.array(rubricCriterionSchema).min(1).max(12);

export const DEFAULT_SEQUENCE_WORDS = [
  "first",
  "next",
  "then",
  "after",
  "later",
  "finally",
  "last",
  "at the end",
  "in the end",
  "now",
];

const RUBRIC_ERRORS: Record<RubricDimension, WritingErrorType> = {
  words: "WRITING_TOO_SHORT",
  sentences: "WRITING_SENTENCES",
  keywords: "WRITING_CONTENT",
  capitalization: "CAPITALIZATION",
  punctuation: "PUNCTUATION",
  spacing: "SPACING",
  spelling: "MISSPELLED",
  sequence_words: "WRITING_SEQUENCE",
  structure: "WRITING_STRUCTURE",
  not_copied: "WRITING_COPIED",
  topic_sentence: "WRITING_TOPIC",
  ending: "WRITING_ENDING",
  lines_filled: "WRITING_INCOMPLETE",
};

// How keyword groups are matched: on the server the groups are plain words and `has`
// compares them with the child's phrases; on the device they are salted digests and `has`
// compares digests (answer-key.ts), so the device never holds the words.
export type PhraseMatcher = (alternatives: string[]) => boolean;

export function plainMatcher(text: string): PhraseMatcher {
  const phrases = new Set(phrasesOf(text));
  return (alternatives) => alternatives.some((a) => phrases.has(canonicalPhrase(a)));
}

export type RubricContext = {
  mechanics: MechanicsSettings;
  minSentenceWords: number;
  // Known words (word bank and its forms), for spelling and spacing. Server only.
  lexicon?: Set<string>;
};

// Evaluates open-ended writing. `lines` are the boxes the child filled (one for a free
// sentence or paragraph; one per frame or paragraph part); `match` checks keyword groups
// against the whole text, `firstSentenceMatch` against the first sentence only.
export function evaluateRubric(args: {
  criteria: RubricCriterion[];
  lines: string[];
  match: PhraseMatcher;
  firstSentenceMatch: PhraseMatcher;
  context: RubricContext;
}): WritingVerdict {
  const lines = args.lines.map((l) => normalizeWritingText(l).trim());
  const filled = lines.filter((l) => writtenWords(l).length > 0);
  const text = filled.join(" ");
  const words = writtenWords(text);
  const sentences = filled.flatMap((l) => writtenSentences(l));
  const lexicon = args.context.lexicon;
  const mechanics = analyzeMechanics(filled, lexicon ?? []);
  const results: CriterionResult[] = [];

  let spelling: WritingAnalysis["spelling"];
  for (const c of args.criteria) {
    const base = { id: c.id, dimension: c.dimension, label: c.label, hint: c.hint };
    let met: boolean | null;
    let isCritical: boolean;
    let detail: string | undefined;
    switch (c.dimension) {
      case "words":
        met = words.length >= c.min && (c.max === undefined || words.length <= c.max);
        isCritical = c.critical;
        detail = `${words.length} words`;
        break;
      case "sentences":
        met = sentences.length >= c.min && (c.max === undefined || sentences.length <= c.max);
        isCritical = c.critical;
        detail = `${sentences.length} sentences`;
        break;
      case "keywords": {
        const found = c.groups.filter((g) => args.match(g)).length;
        met = found >= (c.min ?? c.groups.length);
        isCritical = c.critical;
        detail = `${found} of ${c.groups.length}`;
        break;
      }
      case "capitalization":
      case "punctuation":
      case "spacing": {
        const mode = args.context.mechanics[c.dimension];
        if (c.critical === "level" && mode === "off") continue;
        met = c.dimension === "spacing" ? spacingMet(mechanics) : mechanics[c.dimension].ok;
        // Words run together are found by splitting unknown words into known ones, which a
        // word list cannot do reliably for free writing ("everyone" is not "every one"), so
        // spacing is only a tip here; it can be required where the words are known (copying).
        isCritical =
          c.dimension === "spacing" ? false : c.critical === "level" ? mode === "required" : c.critical;
        break;
      }
      case "spelling": {
        if (!lexicon) {
          met = null;
        } else {
          const misspelled: { written: string; suggestion: string }[] = [];
          let unchecked = 0;
          for (const w of new Set(words.filter((x) => /^\p{L}[\p{L}']*$/u.test(x) && x.length > 1))) {
            if (lexicon.has(w)) continue;
            let suggestion: string | null = null;
            for (const k of lexicon) {
              if (Math.abs(k.length - w.length) > 2 || k.length < 3) continue;
              if (editDistance(k, w) <= (w.length >= 5 ? 2 : 1)) {
                suggestion = k;
                break;
              }
            }
            if (suggestion) misspelled.push({ written: w, suggestion });
            else unchecked++;
          }
          spelling = { misspelled, unchecked };
          met = misspelled.length === 0;
        }
        isCritical = false;
        break;
      }
      case "sequence_words": {
        const list = c.words ?? DEFAULT_SEQUENCE_WORDS;
        const phrases = new Set(phrasesOf(text));
        const found = list.filter((w) => phrases.has(canonicalPhrase(w))).length;
        met = found >= c.min;
        isCritical = c.critical;
        break;
      }
      case "structure": {
        const min = c.minWordsPerSentence ?? args.context.minSentenceWords;
        const unique = new Set(words).size;
        met =
          sentences.length > 0 &&
          sentences.every((s) => writtenWords(s).length >= min) &&
          unique >= Math.min(words.length, Math.max(2, Math.ceil(words.length * 0.4)));
        isCritical = c.critical;
        break;
      }
      case "not_copied": {
        const given = new Set(writtenWords(c.text));
        met = words.some((w) => !given.has(w));
        isCritical = c.critical;
        break;
      }
      case "topic_sentence":
        met = sentences.length > 0 && c.groups.some((g) => args.firstSentenceMatch(g));
        isCritical = c.critical;
        break;
      case "ending": {
        const last = sentences[sentences.length - 1];
        met =
          sentences.length >= c.minSentences &&
          !!last &&
          writtenWords(last).length >= 3 &&
          canonicalPhrase(last) !== canonicalPhrase(sentences[0]);
        isCritical = c.critical;
        break;
      }
      case "lines_filled":
        met = filled.length >= c.min;
        isCritical = c.critical;
        detail = `${filled.length} of ${lines.length}`;
        break;
    }
    results.push({ ...base, critical: isCritical, met, ...(detail ? { detail } : {}) });
  }
  return verdictFrom(
    results,
    {
      v: 1,
      kind: "rubric",
      criteria: results,
      words: words.length,
      sentences: sentences.length,
      mechanics,
      ...(spelling ? { spelling } : {}),
    },
    RUBRIC_ERRORS,
  );
}

// ---- story sequence writing ----------------------------------------------------------------

// Put pictures of a story in order, then write a sentence for each. The order is critical;
// each sentence is checked with its event's criteria (keyword groups for what happens in
// that picture), and the whole text with the overall criteria (sequence words, mechanics).
export function evaluateStoryWriting(args: {
  acceptedOrders: string[][];
  sequence: string[];
  lines: string[];
  eventCriteria: Record<string, RubricCriterion[]>;
  criteria: RubricCriterion[];
  matcherFor: (text: string) => PhraseMatcher;
  context: RubricContext;
}): WritingVerdict {
  const norm = (ids: string[]) => ids.map((i) => i.trim().toLowerCase()).join("|");
  const orderOk = args.acceptedOrders.some((o) => norm(o) === norm(args.sequence));
  const results: CriterionResult[] = [
    {
      id: "order",
      dimension: "order",
      label: "Pictures in order",
      hint: "What happened first? What happened next?",
      critical: true,
      met: orderOk,
    },
  ];
  args.sequence.forEach((eventId, i) => {
    const line = args.lines[i] ?? "";
    const criteria = args.eventCriteria[eventId] ?? [];
    if (criteria.length === 0) return;
    const sub = evaluateRubric({
      criteria,
      lines: [line],
      match: args.matcherFor(line),
      firstSentenceMatch: args.matcherFor(writtenSentences(line)[0] ?? ""),
      context: args.context,
    });
    for (const r of sub.analysis.criteria)
      results.push({ ...r, id: `${i + 1}-${r.id}`, label: `Picture ${i + 1}: ${r.label}` });
  });
  const whole = args.lines.join(" ");
  const overall = evaluateRubric({
    criteria: args.criteria,
    lines: args.lines,
    match: args.matcherFor(whole),
    firstSentenceMatch: args.matcherFor(writtenSentences(whole)[0] ?? ""),
    context: args.context,
  });
  results.push(...overall.analysis.criteria);
  const errors: Record<string, WritingErrorType> = { order: "WRITING_ORDER", ...RUBRIC_ERRORS };
  for (const r of results) {
    const dim = r.dimension as RubricDimension;
    if (RUBRIC_ERRORS[dim]) errors[r.id] = RUBRIC_ERRORS[dim];
  }
  const verdict = verdictFrom(
    results,
    {
      v: 1,
      kind: "story",
      criteria: results,
      words: writtenWords(whole).length,
      sentences: args.lines.flatMap((l) => writtenSentences(l)).length,
      mechanics: overall.analysis.mechanics,
      ...(overall.analysis.spelling ? { spelling: overall.analysis.spelling } : {}),
      orderOk,
    },
    errors,
  );
  return verdict;
}

// ---- letter review -----------------------------------------------------------------------

// First tries at forming one letter, newest first.
export type LetterTry = { isCorrect: boolean; attemptedAt: string };

// A letter formed wrongly in `missesForReview` of the last `lookback` first tries comes back
// for review; it is resolved by `correctToResolve` right first tries in a row.
export function letterNeedsReview(
  tries: LetterTry[],
  rules: WritingRules["letterReview"] = DEFAULT_RULES.writing.letterReview,
): boolean {
  const sorted = [...tries].sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt));
  const streak = sorted.findIndex((t) => !t.isCorrect);
  if (streak === -1 || streak >= rules.correctToResolve) return false;
  const misses = sorted.slice(0, rules.lookback).filter((t) => !t.isCorrect).length;
  return misses >= rules.missesForReview;
}

export const writingKey = (glyphId: string) => `writing:${glyphId}`;

// The review item for one letter, or null when it does not need review. It points at the
// lesson where the letter is practised, so the daily plan can send the child there.
export function deriveLetterReview(
  letter: { glyphId: string; skillId: string | null; lessonId: string | null; tries: LetterTry[] },
  now: Date,
  rules: WritingRules["letterReview"] = DEFAULT_RULES.writing.letterReview,
): ReviewItemRow | null {
  if (!letterNeedsReview(letter.tries, rules)) return null;
  const misses = [...letter.tries]
    .sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt))
    .slice(0, rules.lookback)
    .filter((t) => !t.isCorrect).length;
  return {
    item_key: writingKey(letter.glyphId),
    skill_id: letter.skillId,
    word_id: null,
    phonics_pattern_id: null,
    lesson_id: letter.lessonId,
    glyph_id: letter.glyphId,
    priority: Math.min(100, 45 + 10 * misses),
    due_at: now.toISOString(),
    reason: "writing_letter",
    status: "open",
    resolved_at: null,
  };
}
