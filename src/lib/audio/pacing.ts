// How speech is paced (pure; no browser APIs). The audio service asks this module how to
// read a piece of text: at what rate, in which pieces, with what silence between them.
// Numbers come from the `audio` learning rules (rules.ts), resolved per level, so nothing
// about pacing lives in a component. See docs/audio-engine.md.

import { DEFAULT_RULES, type AudioRules, type ReadingPace } from "@/lib/learning/rules";

// What a request is trying to teach. It decides the pacing, never the words: the words
// come from the pronunciation resolver, which keeps sounds, letter names and words apart.
//   INSTRUCTION  a prompt or explanation ("Tap the word that starts with …")
//   FEEDBACK     "Great job!", "Try again. Start each sentence with a capital letter."
//   WORD         a whole word ("gate") — never spelled out
//   SENTENCE     a sentence to read, hear or write
//   STORY_READING a story or text read aloud, paced for the child's level
//   LETTER_NAME  a letter's name (the capital letter: "G")
//   PHONEME      a sound (/g/ → "guh" — never the letter name)
//   SEGMENTING   a word's sounds one by one (g … ay … t), with clear gaps
//   BLENDING     the sounds, then the whole word (g … ay … t … gate)
export const AUDIO_INTENTS = [
  "INSTRUCTION",
  "FEEDBACK",
  "WORD",
  "SENTENCE",
  "STORY_READING",
  "LETTER_NAME",
  "PHONEME",
  "SEGMENTING",
  "BLENDING",
] as const;
export type AudioIntent = (typeof AUDIO_INTENTS)[number];

export type AudioSpeedName = "normal" | "slow";

// The pacing for one level, ready for the service.
export type AudioPacing = {
  level: string;
  reading: Record<AudioSpeedName, ReadingPace>;
  phonics: AudioRules["phonics"];
};

export function resolveAudioPacing(
  rules: AudioRules = DEFAULT_RULES.audio,
  levelCode?: string | null,
): AudioPacing {
  const level =
    levelCode && rules.levels[levelCode]
      ? levelCode
      : rules.levels[rules.defaultLevel]
        ? rules.defaultLevel
        : Object.keys(rules.levels)[0];
  return { level, reading: rules.levels[level], phonics: rules.phonics };
}

export const DEFAULT_AUDIO_PACING = resolveAudioPacing();

// Stories and sentences follow the level. Instructions and feedback are natural
// sentences at Normal and phrases of three words or more at Slow — never word by word
// (that sounds broken). A word is one piece.
export function paceFor(intent: AudioIntent, speed: AudioSpeedName, pacing: AudioPacing): ReadingPace {
  const pace = pacing.reading[speed];
  if (intent === "STORY_READING" || intent === "SENTENCE") return pace;
  if (intent === "WORD") return { ...pace, chunk: "sentence" };
  if (intent === "LETTER_NAME" || intent === "PHONEME")
    return { ...pace, rate: pacing.phonics.rate[speed], chunk: "sentence" };
  // Instructions, feedback, and the words of a segmenting / blending sequence.
  if (speed === "normal") return { ...pace, chunk: "sentence" };
  return { ...pace, chunk: "phrase", maxWords: Math.max(pace.maxWords, 3) };
}

export type SpeechChunk = {
  text: string;
  // Words of the request text this piece covers (for highlighting), counted as in
  // `countWords`.
  wordStart: number;
  wordCount: number;
  // Silence before this piece (0 for the first).
  pauseBeforeMs: number;
};

const isWord = (token: string) => /[\p{L}\p{N}]/u.test(token);

export function countWords(text: string) {
  return text.split(/\s+/).filter(isWord).length;
}

// Words that lean on the word after them (Phase 8.3). Read on their own, or left at the end
// of a piece, voices give them a strange stressed or clipped form — "the" alone was hard to
// understand on an iPhone. Articles and possessives always stay with their noun ("the
// gate", "a ball", "my dog"), even word by word; in phrases, no piece ends on any of them.
const ARTICLES = new Set(["a", "an", "the", "my", "your", "his", "her", "its", "our", "their"]);
const LEANERS = new Set([
  ...ARTICLES,
  "at",
  "in",
  "on",
  "to",
  "of",
  "for",
  "with",
  "by",
  "from",
  "into",
  "up",
  "and",
  "or",
  "but",
  "this",
  "that",
]);

const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}']/gu, "");
// A letter's name inside a sentence ("the letter S.", "learn S H.") — never a piece on its
// own: a one-syllable name read alone is what iOS clipped (Phase 8.3). "I" and "A" are words.
const letterName = (w: string) => /^[B-HJ-Z][,;:.!?…]*$/.test(w);
// Ends a clause or sentence: a word with punctuation after it never leans forward.
const closes = (w: string) => /[,;:.!?…]$/.test(w);

// Tokens → units that are never split: a leaning word joined to the word after it (and
// any loose punctuation to the word before).
function units(tokens: string[], leaners: ReadonlySet<string>): string[][] {
  const out: string[][] = [];
  let pending: string[] = [];
  for (const t of tokens) {
    if ((!isWord(t) || letterName(t)) && (pending.length || out.length)) {
      if (pending.length) pending.push(t);
      else out[out.length - 1].push(t);
      continue;
    }
    pending.push(t);
    if (leaners.has(bare(t)) && !closes(t)) continue;
    out.push(pending);
    pending = [];
  }
  if (pending.length) {
    if (out.length && pending.every((t) => leaners.has(bare(t)) || !isWord(t)))
      out[out.length - 1].push(...pending);
    else out.push(pending);
  }
  return out;
}

const wordsIn = (group: string[]) => group.filter(isWord).length;

// Phrases of about `max` words, never splitting a unit, never across a comma's natural
// break. The grouping is chosen as a whole (each clause is short, so all groupings are
// weighed): few pieces, close to `max` words each, balanced ("The cat is | at the gate.",
// not "The cat | is at the gate."). A piece may run one word over `max` when that keeps a
// phrase together, at a cost, so Normal stays phrased and Slow stays deliberate.
function phrases(tokens: string[], max: number): string[][] {
  const groups: string[][] = [];
  const PIECE = 12;
  const OVER = 12;
  const best = (clause: string[][]) => {
    const n = clause.length;
    const words = clause.map(wordsIn);
    const cost: number[] = [0, ...Array<number>(n).fill(Infinity)];
    const from: number[] = Array<number>(n + 1).fill(0);
    for (let end = 1; end <= n; end++) {
      let k = 0;
      for (let start = end - 1; start >= 0; start--) {
        k += words[start];
        const single = end - start === 1;
        if (!single && k > max + 1) break;
        const c = cost[start] + PIECE + Math.max(0, k - max) * OVER + 0.5 * k * k;
        if (c < cost[end]) {
          cost[end] = c;
          from[end] = start;
        }
      }
    }
    const cut: string[][] = [];
    for (let end = n; end > 0; end = from[end]) cut.unshift(clause.slice(from[end], end).flat());
    groups.push(...cut);
  };
  let clause: string[][] = [];
  for (const u of units(tokens, LEANERS)) {
    clause.push(u);
    if (/[,;:]$/.test(u[u.length - 1])) {
      best(clause);
      clause = [];
    }
  }
  if (clause.length) best(clause);
  return groups;
}

// Text → the pieces to speak, with the silence before each. Punctuation stays on its word
// (the voice uses it for intonation: "gate." falls, "gate?" rises).
export function chunkText(text: string, pace: ReadingPace, maxChars = 200): SpeechChunk[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?…])\s+(?=\S)/);
  const chunks: SpeechChunk[] = [];
  let wordIndex = 0;
  sentences.forEach((sentence, si) => {
    const tokens = sentence.split(" ").filter(Boolean);
    let groups: string[][];
    // Word by word: each word, with articles and possessives kept on their noun.
    if (pace.chunk === "word") groups = units(tokens, ARTICLES);
    else if (pace.chunk === "phrase") groups = phrases(tokens, pace.maxWords);
    else groups = [tokens];
    // A sentence longer than an engine safely reads in one go is split at phrases.
    groups = groups.flatMap((g) => (g.join(" ").length > maxChars ? phrases(g, 12) : [g]));
    groups.forEach((g, gi) => {
      const count = wordsIn(g);
      chunks.push({
        text: g.join(" "),
        wordStart: wordIndex,
        wordCount: count,
        pauseBeforeMs: chunks.length === 0 ? 0 : gi === 0 && si > 0 ? pace.sentenceGapMs : pace.pauseMs,
      });
      wordIndex += count;
    });
  });
  return chunks;
}

// The silence a pace adds to a text, in ms: the part of Slow that does not depend on the
// engine honouring the rate.
export function addedSilenceMs(text: string, pace: ReadingPace) {
  return chunkText(text, pace).reduce((ms, c) => ms + c.pauseBeforeMs, 0);
}
