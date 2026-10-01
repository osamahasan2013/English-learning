import type { TemplateWord } from "@/lib/content/templates";

// Vocabulary content rules used at import time: choosing wrong answers (distractors) from
// the word bank, finding a word in its example sentence, deriving word-family members from
// grapheme splits and checking example sentences. Pure and deterministic, so re-importing
// produces identical questions.

export type DistractorStrategy =
  // Clearly different words (another category): easiest, for the youngest children.
  | "contrast"
  // Words from the same category and part of speech: closer, harder.
  | "category"
  // Words that look and sound alike (cat / cap / cut): recognising the exact word.
  | "similar"
  // Same part of speech, another category: fits a sentence's grammar but not its meaning.
  | "grammar"
  // Another part of speech and category: makes a sentence plainly wrong ("The girl is table.").
  | "nonsense";

export type DistractorNeed = "emoji" | "definition";

export type DistractorOptions = {
  count: number;
  strategy: DistractorStrategy;
  need?: DistractorNeed[];
  // The lesson's level rank (1 = KG1): distractors are words a child at that level knows.
  levelRank?: number;
  seed: string;
  exclude?: string[];
};

const FUNCTION_CATEGORY = "FUNCTION_WORDS";
const norm = (s: string) => s.trim().toLowerCase();

// mulberry-style hash → 0..1, so ties between equally good distractors are broken the same
// way on every import.
function hash01(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

export function editDistance(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

const topCategory = (w: TemplateWord) => w.topCategory ?? w.category ?? null;

// Words that would make a question ambiguous or unfair are never distractors: the word
// itself, its synonyms (two right answers), words without the picture/meaning the
// question shows, words sharing the target's picture, and words above the child's level.
function eligible(target: TemplateWord, w: TemplateWord, opts: DistractorOptions, levelSlack: number) {
  const t = norm(target.word);
  const c = norm(w.word);
  if (c === t || (opts.exclude ?? []).map(norm).includes(c)) return false;
  if ((target.synonyms ?? []).map(norm).includes(c) || (w.synonyms ?? []).map(norm).includes(t)) return false;
  if ((target.forms ?? []).map(norm).includes(c)) return false;
  if ((topCategory(w) === FUNCTION_CATEGORY) !== (topCategory(target) === FUNCTION_CATEGORY)) return false;
  const need = opts.need ?? [];
  if (need.includes("emoji") && (!w.emoji || w.emoji === target.emoji)) return false;
  if (need.includes("definition") && (!w.childDefinition || norm(w.childDefinition) === norm(target.childDefinition)))
    return false;
  if (opts.levelRank && w.levelRank && w.levelRank > opts.levelRank + levelSlack) return false;
  return true;
}

function score(target: TemplateWord, w: TemplateWord, strategy: DistractorStrategy) {
  const sameCategory = !!topCategory(w) && topCategory(w) === topCategory(target);
  const samePos = !!w.partOfSpeech && w.partOfSpeech === target.partOfSpeech;
  const closeDifficulty = Math.abs((w.difficulty ?? 1) - (target.difficulty ?? 1)) <= 2;
  switch (strategy) {
    case "contrast":
      return (sameCategory ? 0 : 4) + (samePos ? 2 : 0) + (closeDifficulty ? 1 : 0);
    case "category":
      return (sameCategory ? 4 : 0) + (samePos ? 2 : 0) + (closeDifficulty ? 1 : 0);
    case "grammar":
      return (samePos ? 4 : -10) + (sameCategory ? -10 : 2) + (closeDifficulty ? 1 : 0);
    case "nonsense":
      return (samePos ? -10 : 4) + (sameCategory ? -10 : 2) + (closeDifficulty ? 1 : 0);
    case "similar": {
      const a = norm(target.word);
      const b = norm(w.word);
      const distance = editDistance(a, b);
      if (distance > Math.max(2, Math.floor(a.length / 2))) return -10;
      return 6 - 2 * distance + (a[0] === b[0] ? 1 : 0) + (a.length === b.length ? 1 : 0);
    }
  }
}

// Picks `count` distractors for `target` from the bank, best first; throws when the bank
// cannot supply enough suitable words (the import reports it instead of using random ones).
export function pickDistractors(target: TemplateWord, bank: TemplateWord[], opts: DistractorOptions): TemplateWord[] {
  for (const slack of [0, 1]) {
    const ranked = bank
      .filter((w) => eligible(target, w, opts, slack))
      .map((w) => ({ w, s: score(target, w, opts.strategy) }))
      .filter((x) => x.s > -5)
      .sort((a, b) => b.s - a.s || hash01(`${opts.seed}|${a.w.word}`) - hash01(`${opts.seed}|${b.w.word}`));
    const picked: TemplateWord[] = [];
    const emojis = new Set([target.emoji]);
    for (const { w } of ranked) {
      if (picked.length >= opts.count) break;
      if (opts.need?.includes("emoji") && emojis.has(w.emoji)) continue;
      if (opts.need?.includes("definition") && picked.some((p) => norm(p.childDefinition) === norm(w.childDefinition)))
        continue;
      emojis.add(w.emoji);
      picked.push(w);
    }
    if (picked.length >= opts.count) return picked;
  }
  throw new Error(`not enough suitable distractors for "${target.word}" (${opts.strategy})`);
}

// A group of `count` words from ONE other category (for sorting: animals vs food) — the
// category with the most suitable words, ties broken by the seed.
export function pickContrastGroup(
  target: TemplateWord,
  bank: TemplateWord[],
  opts: Omit<DistractorOptions, "strategy">,
): TemplateWord[] {
  for (const slack of [0, 1]) {
    const groups = new Map<string, TemplateWord[]>();
    for (const w of bank) {
      const category = topCategory(w);
      if (!category || category === topCategory(target) || category === FUNCTION_CATEGORY) continue;
      if (!eligible(target, w, { ...opts, strategy: "contrast" }, slack)) continue;
      const list = groups.get(category) ?? [];
      if (opts.need?.includes("emoji") && list.some((x) => x.emoji === w.emoji)) continue;
      list.push(w);
      groups.set(category, list);
    }
    const best = [...groups]
      .filter(([, list]) => list.length >= opts.count)
      .sort(
        ([a, x], [b, y]) =>
          y.length - x.length || hash01(`${opts.seed}|${a}`) - hash01(`${opts.seed}|${b}`),
      )[0];
    if (best)
      return [...best[1]]
        .sort((a, b) => hash01(`${opts.seed}|${a.word}`) - hash01(`${opts.seed}|${b.word}`))
        .slice(0, opts.count);
  }
  throw new Error(`no other category has ${opts.count} suitable words to sort against "${target.word}"`);
}

// How hard recognition questions are at each level: the number of wrong options and how
// close they are to the answer.
export function distractorPlan(levelRank: number | undefined): { count: number; strategy: DistractorStrategy } {
  const rank = levelRank ?? 1;
  if (rank <= 2) return { count: 2, strategy: "contrast" };
  if (rank === 3) return { count: 3, strategy: "contrast" };
  return { count: 3, strategy: "category" };
}

// ---------------------------------------------------------------------------------------
// Sentences

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Finds the word (or one of its forms: plural, -ing, past…) as a whole word in a sentence.
export function findWordInSentence(sentence: string, word: string, forms: string[] = []) {
  for (const candidate of [word, ...forms].filter(Boolean)) {
    const match = new RegExp(`(^|[^A-Za-z'])(${escape(candidate)})(?=$|[^A-Za-z'])`, "i").exec(sentence);
    if (match) {
      const start = match.index + match[1].length;
      return {
        before: sentence.slice(0, start),
        match: sentence.slice(start, start + match[2].length),
        after: sentence.slice(start + match[2].length),
        form: candidate,
      };
    }
  }
  return null;
}

// The same sentence with the word swapped for another one — a sentence that does not make
// sense ("The girl is table."), for choosing the sentence that uses the word correctly.
export function swapWord(sentence: string, word: string, replacement: string, forms: string[] = []) {
  const found = findWordInSentence(sentence, word, forms);
  if (!found) return null;
  const capital = /^[A-Z]/.test(found.match);
  const swapped = capital ? replacement[0].toUpperCase() + replacement.slice(1) : replacement.toLowerCase();
  return `${found.before}${swapped}${found.after}`;
}

// Curated example sentences must be simple, grammatical-looking and about the word: a
// capital letter (or quote) first, end punctuation, the word itself (or a form of it)
// inside, and no longer than the level allows.
export function exampleSentenceIssues(
  sentence: string,
  word: string,
  forms: string[] = [],
  maxWords?: number,
): string[] {
  const issues: string[] = [];
  const text = sentence.trim();
  if (!text) return ["is empty"];
  if (!/^["“]?[A-Z]/.test(text)) issues.push("should start with a capital letter");
  if (!/[.!?]["”]?$/.test(text)) issues.push("should end with . ! or ?");
  if (/\s{2,}/.test(text)) issues.push("has double spaces");
  if (!findWordInSentence(text, word, forms)) issues.push(`does not use "${word}"`);
  const words = text.split(/\s+/).length;
  if (maxWords && words > maxWords) issues.push(`has ${words} words (the level allows ${maxWords})`);
  return issues;
}

// ---------------------------------------------------------------------------------------
// Word families

export type FamilyCandidate = {
  word: string;
  syllables: number;
  segments: { grapheme: string; phonemes: string[] }[];
};

const VOWEL_LETTERS = /[aeiouy]/;

// Members of a rime family (-at: cat, bat, that): one-syllable words that end in the rime
// after a consonant-only onset, whose vowel really makes the family's sound — "what" is
// not in -at (its a is not short a), "boat" is not either (its onset has a vowel).
export function familyMembers(rime: string, vowelPhonemes: string[], words: FamilyCandidate[]) {
  return words
    .filter((w) => {
      const text = w.word.toLowerCase();
      if (!/^[a-z]+$/.test(text) || w.syllables !== 1 || !text.endsWith(rime) || text === rime) return false;
      const onset = text.slice(0, text.length - rime.length);
      if (VOWEL_LETTERS.test(onset.replace(/^y/, ""))) return false;
      if (w.segments.length === 0) return false;
      const vowel = w.segments.find((s) => s.phonemes.some((p) => /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)$/.test(p)));
      if (!vowel) return false;
      return vowelPhonemes.length === 0 || vowelPhonemes.every((p, i) => vowel.phonemes[i] === p);
    })
    .map((w) => w.word)
    .sort();
}
