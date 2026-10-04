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
//   LETTER_NAME  a letter's name ("jee")
//   PHONEME      a sound (/g/ — never "jee")
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
// sentences at Normal (sounds and letter names inside them are still pieces of their own)
// and phrases at Slow — never word by word (that sounds broken). A word is one piece.
export function paceFor(intent: AudioIntent, speed: AudioSpeedName, pacing: AudioPacing): ReadingPace {
  const pace = pacing.reading[speed];
  if (intent === "STORY_READING" || intent === "SENTENCE") return pace;
  if (intent === "WORD") return { ...pace, chunk: "sentence" };
  if (intent === "LETTER_NAME" || intent === "PHONEME")
    return { ...pace, rate: pacing.phonics.rate[speed], chunk: "sentence" };
  // Instructions, feedback, and the words of a segmenting / blending sequence.
  if (speed === "normal") return { ...pace, chunk: "sentence" };
  if (pace.chunk === "word") return { ...pace, chunk: "phrase", maxWords: Math.max(pace.maxWords, 3) };
  return pace;
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

// Phrases of at most `max` words, balanced (7 words in threes → 3, 2, 2 rather than 3, 3,
// 1), never splitting after a comma's natural break.
function phrases(words: string[], max: number): string[][] {
  const groups: string[][] = [];
  let clause: string[] = [];
  const flush = () => {
    if (clause.length === 0) return;
    const n = Math.ceil(clause.length / max);
    const size = Math.ceil(clause.length / n);
    for (let i = 0; i < clause.length; i += size) groups.push(clause.slice(i, i + size));
    clause = [];
  };
  for (const w of words) {
    clause.push(w);
    if (/[,;:]$/.test(w)) flush();
  }
  flush();
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
    if (pace.chunk === "word") {
      // Words, with any loose punctuation kept on the word before it.
      groups = [];
      for (const t of tokens) {
        if (!isWord(t) && groups.length) groups[groups.length - 1].push(t);
        else groups.push([t]);
      }
    } else if (pace.chunk === "phrase") groups = phrases(tokens, pace.maxWords);
    else groups = [tokens];
    // A sentence longer than an engine safely reads in one go is split at phrases.
    groups = groups.flatMap((g) => (g.join(" ").length > maxChars ? phrases(g, 12) : [g]));
    groups.forEach((g, gi) => {
      const count = g.filter(isWord).length;
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
