// Question templates: short, readable authoring forms that the importer expands into full
// questions using the word bank and phonics patterns. A template never invents content:
// pictures, definitions and sounds all come from the stored words and patterns, so fixing
// a word fixes every question built from it.
//
//   { "template": "missing_pattern", "word": "ship", "pattern": "SH", "choices": ["sh", "ch", "th"] }
//
// See docs/curriculum.md → "Authoring content" for the full list and examples.

import {
  distractorPlan,
  findWordInSentence,
  pickContrastGroup,
  pickDistractors,
  swapWord,
  type DistractorNeed,
  type DistractorStrategy,
} from "@/lib/content/vocabulary";
import type { WordArea } from "@/lib/learning/vocabulary";

export type TemplateSegment = {
  grapheme: string;
  patternCode: string | null;
  sayAs: string;
  phonemes: string[];
};

export type TemplateWord = {
  word: string;
  emoji: string;
  childDefinition: string;
  patterns: { code: string; sound?: string }[];
  // The word's grapheme split (src/lib/learning/phonics.ts); empty if not decomposed.
  segments?: TemplateSegment[];
  // Vocabulary facts, used to choose distractors and build meaning/usage questions.
  category?: string | null;
  topCategory?: string | null;
  topCategoryName?: string;
  topCategoryEmoji?: string;
  levelRank?: number;
  partOfSpeech?: string;
  difficulty?: number;
  syllables?: number;
  // Only published words are offered as distractors.
  published?: boolean;
  // Curated example sentences, first = main.
  examples?: string[];
  synonyms?: string[];
  // Other written forms that count as the word (plural, -ing, past…).
  forms?: string[];
};

export type TemplatePattern = {
  code: string;
  pattern: string;
  type: string;
  childExplanation: string;
  sounds: { code: string; label: string; sayAs: string; primary: boolean; phonemes?: string[] }[];
  uppercase?: string | null;
  letterName?: string;
  letterNameSayAs?: string;
};

export type TemplatePhoneme = { code: string; label: string; sayAs: string; kind: string };

export type TemplateContext = {
  word: (text: string) => TemplateWord | undefined;
  pattern: (code: string) => TemplatePattern | undefined;
  phoneme?: (code: string) => TemplatePhoneme | undefined;
  // Deterministic seed (the question code), so re-imports produce identical content.
  seed: string;
  // The word bank (vocabulary templates choose distractors from it) and the lesson's level
  // rank (1 = KG1), which sets how many and how close the distractors are.
  words?: () => TemplateWord[];
  levelRank?: number;
};

export type ExpandedQuestion = {
  type: string;
  prompt: string;
  promptSpeech: string;
  content: Record<string, unknown>;
  answer: Record<string, unknown> | null;
  word?: string;
  pattern?: string;
  // What the question exercises for its word (stored as metadata.wordArea).
  area?: WordArea;
  // A sentence of the sentence bank the question is built on (linked as sentence_id).
  sentence?: string;
};

type Params = Record<string, unknown>;

export class TemplateError extends Error {}

function str(params: Params, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.trim() === "") throw new TemplateError(`"${key}" is required`);
  return value.trim();
}
function optStr(params: Params, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
function strList(params: Params, key: string, required = true): string[] {
  const value = params[key];
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
    throw new TemplateError(`"${key}" must be a list of text`);
  return value as string[];
}

export function optionId(text: string) {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "option"
  );
}

// mulberry32 seeded from a string hash: stable shuffles per question code.
function random(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: T[], seed: string, avoidIdentity = false): T[] {
  const rand = random(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (avoidIdentity && out.length > 1 && out.every((item, i) => item === items[i])) {
    out.push(out.shift()!);
  }
  return out;
}

function needWord(ctx: TemplateContext, text: string) {
  const word = ctx.word(text);
  if (!word) throw new TemplateError(`word "${text}" is not in the word bank`);
  return word;
}
function needPattern(ctx: TemplateContext, code: string) {
  const pattern = ctx.pattern(code.toUpperCase());
  if (!pattern) throw new TemplateError(`phonics pattern "${code}" does not exist`);
  return pattern;
}
function primarySound(pattern: TemplatePattern, soundCode?: string) {
  const sound = soundCode
    ? pattern.sounds.find((s) => s.code === soundCode.toUpperCase())
    : pattern.sounds.find((s) => s.primary);
  if (!sound) throw new TemplateError(`sound "${soundCode}" is not defined for ${pattern.code}`);
  return sound;
}
function wordOptions(ctx: TemplateContext, words: string[], withEmoji: boolean) {
  return words.map((text) => {
    const w = needWord(ctx, text);
    return {
      id: optionId(w.word),
      text: w.word,
      speech: w.word,
      ...(withEmoji && w.emoji ? { emoji: w.emoji } : {}),
    };
  });
}
function needSegments(word: TemplateWord) {
  if (!word.segments || word.segments.length === 0)
    throw new TemplateError(`word "${word.word}" has no grapheme split`);
  return word.segments;
}
function soundLabelFor(ctx: TemplateContext, phonemes: string[] | undefined, fallback: string) {
  const labels = (phonemes ?? []).map((c) => ctx.phoneme?.(c)?.label).filter((l): l is string => !!l);
  return labels.length ? labels.join("") : fallback;
}
function displayPattern(p: TemplatePattern) {
  return p.type === "letter" ? `${p.pattern.toUpperCase()} ${p.pattern}` : p.pattern;
}

// Distractor words: the ones the author listed, else chosen from the word bank by the
// vocabulary rules (src/lib/content/vocabulary.ts) for the lesson's level.
function distractorWords(
  params: Params,
  ctx: TemplateContext,
  target: TemplateWord,
  opts: { need?: DistractorNeed[]; strategy?: DistractorStrategy; count?: number } = {},
): TemplateWord[] {
  const given = strList(params, "distractors", false);
  if (given.length > 0) return given.map((text) => needWord(ctx, text));
  if (!ctx.words) throw new TemplateError('"distractors" is required');
  const plan = distractorPlan(ctx.levelRank);
  return pickDistractors(target, ctx.words(), {
    count: opts.count ?? plan.count,
    strategy: opts.strategy ?? plan.strategy,
    need: opts.need,
    levelRank: ctx.levelRank,
    seed: ctx.seed,
  });
}
function needEmoji(word: TemplateWord) {
  if (!word.emoji) throw new TemplateError(`word "${word.word}" has no picture`);
  return word.emoji;
}
function needDefinition(word: TemplateWord) {
  if (!word.childDefinition) throw new TemplateError(`word "${word.word}" has no child-friendly meaning`);
  return word.childDefinition;
}
// The example sentence that contains the word itself (not only a form of it).
function exampleWith(word: TemplateWord, preferred?: string) {
  const sentences = [preferred, ...(word.examples ?? [])].filter((s): s is string => !!s);
  for (const sentence of sentences) {
    const found = findWordInSentence(sentence, word.word);
    if (found && found.form.toLowerCase() === word.word.toLowerCase()) return { sentence, found };
  }
  throw new TemplateError(`word "${word.word}" has no example sentence that uses it`);
}
const pictures = (ctx: TemplateContext) => (ctx.levelRank ?? 1) <= 3;
function sameTopCategory(words: TemplateWord[]) {
  const category = words[0]?.topCategory;
  if (!category || words.some((w) => w.topCategory !== category))
    throw new TemplateError("all words must be in the same category");
  return { code: category, name: words[0].topCategoryName || category, emoji: words[0].topCategoryEmoji || "" };
}
const CONSONANT_TILES = ["b", "d", "f", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "w"];
const VOWEL_TILES = ["a", "e", "i", "o", "u"];

type Expander = (params: Params, ctx: TemplateContext) => ExpandedQuestion;

export const TEMPLATES: Record<string, Expander> = {
  // Introduces a phonics pattern: the pattern, its sound(s) (attached by the lesson
  // loader from the pattern record) and example words from the word bank.
  pattern_intro(params, ctx) {
    const pattern = needPattern(ctx, str(params, "pattern"));
    const sound = primarySound(pattern);
    const examples = strList(params, "examples").map((text) => {
      const w = needWord(ctx, text);
      return { text: w.word, emoji: w.emoji || undefined, highlight: pattern.pattern };
    });
    const body = optStr(params, "body") ?? pattern.childExplanation;
    const first = examples[0]?.text;
    return {
      type: "INTRO",
      prompt: "",
      promptSpeech: "",
      pattern: pattern.code,
      content: {
        heading: optStr(params, "heading") ?? displayPattern(pattern),
        display: displayPattern(pattern),
        body,
        speech:
          optStr(params, "speech") ??
          `${body} ${sound.sayAs}${first && !sound.sayAs.includes("as in") ? `, as in ${first}` : ""}.`,
        examples,
      },
      answer: null,
    };
  },

  // Introduces a word (vocabulary or sight word) with its picture and meaning.
  word_intro(params, ctx) {
    const w = needWord(ctx, str(params, "word"));
    const body = optStr(params, "body") ?? w.childDefinition;
    return {
      type: "INTRO",
      prompt: "",
      promptSpeech: "",
      word: w.word,
      content: {
        heading: w.word,
        display: w.word,
        body,
        speech: optStr(params, "speech") ?? `${w.word}. ${body}`,
        examples: w.emoji ? [{ text: w.word, emoji: w.emoji }] : [],
      },
      answer: null,
    };
  },

  // Hear a word, tap its picture.
  listen_pick_picture(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const others = distractorWords(params, ctx, target, { need: ["emoji"] }).map((w) => w.word);
    const words = seededShuffle([target.word, ...others], ctx.seed);
    return {
      type: "LISTEN_AND_CHOOSE",
      prompt: "Find the picture",
      promptSpeech: target.word,
      word: target.word,
      area: "listening",
      content: { hideOptionText: params.showText !== true, options: wordOptions(ctx, words, true) },
      answer: { accepted: [optionId(target.word)] },
    };
  },

  // Hear a word, tap it written (reading, no pictures).
  listen_pick_word(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const others = distractorWords(params, ctx, target, { strategy: "similar" }).map((w) => w.word);
    const words = seededShuffle([target.word, ...others], ctx.seed);
    return {
      type: "LISTEN_AND_CHOOSE",
      prompt: "Tap the word you hear",
      promptSpeech: target.word,
      word: target.word,
      area: "listening",
      content: { options: wordOptions(ctx, words, false).map(({ speech: _speech, ...o }) => o) },
      answer: { accepted: [optionId(target.word)] },
    };
  },

  // Which picture starts with this sound?
  pick_starting_sound(params, ctx) {
    const pattern = needPattern(ctx, str(params, "pattern"));
    const sound = primarySound(pattern, optStr(params, "sound"));
    const target = needWord(ctx, str(params, "word"));
    const words = seededShuffle([target.word, ...strList(params, "distractors")], ctx.seed);
    return {
      type: "PICTURE_MATCH",
      prompt: `Which one starts with ${pattern.pattern}?`,
      promptSpeech: `Which one starts with ${sound.sayAs}?`,
      word: target.word,
      pattern: pattern.code,
      content: {
        display: pattern.type === "letter" ? displayPattern(pattern) : pattern.pattern,
        options: wordOptions(ctx, words, true),
      },
      answer: { accepted: [optionId(target.word)] },
    };
  },

  // Find a letter among look-alikes, by its NAME ("Find the letter bee").
  find_letter(params, ctx) {
    const pattern = needPattern(ctx, str(params, "pattern"));
    const upper = params.case === "upper";
    const show = (l: string) => (upper ? l.toUpperCase() : l.toLowerCase());
    const letters = seededShuffle([pattern.pattern, ...strList(params, "distractors")], ctx.seed);
    const name = pattern.letterNameSayAs || pattern.letterName || pattern.pattern;
    return {
      type: "MULTIPLE_CHOICE",
      prompt: `Find the letter ${show(pattern.pattern)}`,
      promptSpeech: `Find the ${upper ? "big" : "small"} letter ${name}`,
      pattern: pattern.code,
      content: { options: letters.map((l) => ({ id: optionId(l), text: show(l), speech: l })) },
      answer: { accepted: [optionId(pattern.pattern)] },
    };
  },

  // Which word has this pattern (optionally: with this particular sound)?
  pick_word_with_pattern(params, ctx) {
    const pattern = needPattern(ctx, str(params, "pattern"));
    const sound = primarySound(pattern, optStr(params, "sound"));
    const target = needWord(ctx, str(params, "word"));
    const words = seededShuffle([target.word, ...strList(params, "distractors")], ctx.seed);
    return {
      type: "MULTIPLE_CHOICE",
      prompt: `Which word has ${pattern.pattern}?`,
      promptSpeech: `Which word has ${sound.sayAs}?`,
      word: target.word,
      pattern: pattern.code,
      content: { options: wordOptions(ctx, words, params.pictures === true) },
      answer: { accepted: [optionId(target.word)] },
    };
  },

  // Which sound does the pattern make in this word? Models patterns with several
  // pronunciations (EA in "leaf" vs "bread") instead of pretending there is one rule.
  pick_pattern_sound(params, ctx) {
    const pattern = needPattern(ctx, str(params, "pattern"));
    const target = needWord(ctx, str(params, "word"));
    const link = target.patterns.find((p) => p.code === pattern.code);
    if (!link?.sound) throw new TemplateError(`word "${target.word}" has no ${pattern.code} sound recorded`);
    if (pattern.sounds.length < 2) throw new TemplateError(`${pattern.code} has only one sound`);
    return {
      type: "MULTIPLE_CHOICE",
      prompt: `What sound does ${pattern.pattern} make in ${target.word}?`,
      promptSpeech: `${target.word}. What sound does ${pattern.pattern.split("").join(" ")} make?`,
      word: target.word,
      pattern: pattern.code,
      content: {
        display: target.emoji ? `${target.emoji} ${target.word}` : target.word,
        options: pattern.sounds.map((s) => ({ id: optionId(s.code), text: s.label, speech: s.sayAs })),
      },
      answer: { accepted: [optionId(link.sound)] },
    };
  },

  // Fill the gap in a word with the right letter(s).
  missing_pattern(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const missing = str(params, "missing").toLowerCase();
    const at = target.word.toLowerCase().indexOf(missing);
    if (at === -1) throw new TemplateError(`"${missing}" does not appear in "${target.word}"`);
    const before = target.word.slice(0, at);
    const after = target.word.slice(at + missing.length);
    const choices = seededShuffle(
      [missing, ...strList(params, "choices").filter((c) => c !== missing)],
      ctx.seed,
    );
    return {
      type: "MISSING_LETTER",
      prompt: "What is missing?",
      promptSpeech: target.word,
      word: target.word,
      pattern: optStr(params, "pattern"),
      content: {
        word: target.word,
        emoji: target.emoji || undefined,
        parts: [...(before ? [{ text: before }] : []), { blank: true }, ...(after ? [{ text: after }] : [])],
        choices,
      },
      answer: { accepted: [missing] },
    };
  },

  // A letter: its shapes, its NAME and its SOUND as separate things, and example words.
  letter_intro(params, ctx) {
    const pattern = needPattern(ctx, str(params, "pattern"));
    if (pattern.type !== "letter") throw new TemplateError(`${pattern.code} is not a letter`);
    const sound = primarySound(pattern);
    const examples = strList(params, "examples").map((text) => {
      const w = needWord(ctx, text);
      return { text: w.word, emoji: w.emoji || undefined, highlight: pattern.pattern };
    });
    const upper = pattern.uppercase ?? pattern.pattern.toUpperCase();
    const name = pattern.letterName || pattern.pattern;
    const nameSpeech = pattern.letterNameSayAs || name;
    const first = examples[0]?.text;
    const soundLabel = soundLabelFor(ctx, sound.phonemes, pattern.pattern);
    return {
      type: "INTRO",
      prompt: "",
      promptSpeech: "",
      pattern: pattern.code,
      content: {
        heading: `${upper} ${pattern.pattern}`,
        display: `${upper} ${pattern.pattern}`,
        body: optStr(params, "body") ?? pattern.childExplanation,
        speech: `This is the letter ${nameSpeech}. It says ${sound.sayAs}${first ? `, as in ${first}` : ""}.`,
        examples,
        letter: {
          upper,
          lower: pattern.pattern,
          name,
          nameSpeech: `The letter's name is ${nameSpeech}.`,
          soundLabel,
          soundSpeech: sound.sayAs,
        },
      },
      answer: null,
    };
  },

  // Match capital letters to small letters.
  match_upper_lower(params, ctx) {
    const patterns = strList(params, "patterns").map((c) => needPattern(ctx, c));
    if (patterns.length < 2) throw new TemplateError("needs at least two letters");
    const left = patterns.map((p) => ({
      id: `big-${p.pattern}`,
      text: p.uppercase ?? p.pattern.toUpperCase(),
      speech: `big ${p.letterNameSayAs || p.pattern}`,
    }));
    const right = seededShuffle(
      patterns.map((p) => ({ id: `small-${p.pattern}`, text: p.pattern, speech: `small ${p.letterNameSayAs || p.pattern}` })),
      ctx.seed,
      true,
    );
    return {
      type: "MATCH",
      prompt: "Match big and small letters",
      promptSpeech: "Match each big letter to its small letter.",
      pattern: patterns[0].code,
      content: { left, right },
      answer: { pairs: patterns.map((p) => [`big-${p.pattern}`, `small-${p.pattern}`]) },
    };
  },

  // Hear a SOUND, tap the letter (or pattern) that makes it.
  letter_for_sound(params, ctx) {
    const pattern = needPattern(ctx, str(params, "pattern"));
    const sound = primarySound(pattern, optStr(params, "sound"));
    const others = strList(params, "distractors").map((c) => needPattern(ctx, c));
    const options = seededShuffle([pattern, ...others], ctx.seed).map((p) => ({
      id: optionId(p.pattern),
      text: p.pattern,
    }));
    return {
      type: "LISTEN_AND_CHOOSE",
      prompt: "Which one makes this sound?",
      promptSpeech: `Which one says ${sound.sayAs}?`,
      pattern: pattern.code,
      content: { options },
      answer: { accepted: [optionId(pattern.pattern)] },
    };
  },

  // Beginning, middle or end sound of a word: hear the word, tap the letters that make
  // that sound. Uses the word's grapheme split, so "ship" begins with sh, not s.
  sound_at_position(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const where = str(params, "position") as "beginning" | "middle" | "end";
    if (!["beginning", "middle", "end"].includes(where)) throw new TemplateError(`bad position "${where}"`);
    const segments = needSegments(target);
    const sounding = segments.filter((s) => s.phonemes.length > 0);
    const segment =
      where === "beginning"
        ? sounding[0]
        : where === "end"
          ? sounding[sounding.length - 1]
          : sounding.slice(1, -1).find((s) => s.phonemes.some((c) => ctx.phoneme?.(c)?.kind !== "consonant")) ??
            sounding[1];
    if (!segment) throw new TemplateError(`"${target.word}" has no ${where} sound`);
    const choices = strList(params, "choices").filter((c) => c !== segment.grapheme);
    const options = seededShuffle([segment.grapheme, ...choices], ctx.seed).map((g) => ({ id: optionId(g), text: g }));
    return {
      type: "LISTEN_AND_CHOOSE",
      prompt: `What sound is at the ${where === "middle" ? "middle" : where === "end" ? "end" : "beginning"}?`,
      promptSpeech: `${target.word}. What sound do you hear at the ${where} of ${target.word}?`,
      word: target.word,
      pattern: segment.patternCode ?? undefined,
      content: {
        display: target.emoji ? `${target.emoji} ${target.word}` : target.word,
        options,
      },
      answer: { accepted: [optionId(segment.grapheme)] },
    };
  },

  // Blend the word's sounds, then choose the word they make.
  blend_word(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const segments = needSegments(target);
    const words = seededShuffle([target.word, ...strList(params, "distractors")], ctx.seed);
    return {
      type: "BLEND_SOUNDS",
      prompt: "Blend the sounds. What word is it?",
      promptSpeech: "Tap each sound, then blend them. What word do they make?",
      word: target.word,
      pattern: optStr(params, "pattern"),
      content: {
        emoji: target.emoji || undefined,
        units: segments
          .filter((s) => s.phonemes.length > 0)
          .map((s) => ({ grapheme: s.grapheme, sayAs: s.sayAs })),
        options: wordOptions(ctx, words, params.pictures === true),
      },
      answer: { accepted: [optionId(target.word)] },
    };
  },

  // How many sounds, and which ones? Sound cards are phonemes, not letters.
  segment_word(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const segments = needSegments(target);
    const phonemes = segments.flatMap((s) => s.phonemes);
    if (phonemes.length < 2) throw new TemplateError(`"${target.word}" has fewer than two sounds`);
    const phoneme = (code: string) => {
      const p = ctx.phoneme?.(code);
      if (!p) throw new TemplateError(`phoneme ${code} is not defined`);
      return p;
    };
    const cards = [...new Set([...phonemes, ...strList(params, "extraSounds", false)])].map((code) => {
      const p = phoneme(code);
      return { id: code.toLowerCase(), label: p.label, sayAs: p.sayAs };
    });
    return {
      type: "SEGMENT_WORD",
      prompt: "How many sounds?",
      promptSpeech: `${target.word}. How many sounds do you hear in ${target.word}?`,
      word: target.word,
      pattern: optStr(params, "pattern"),
      content: {
        word: target.word,
        emoji: target.emoji || undefined,
        speech: target.word,
        sounds: seededShuffle(cards, ctx.seed),
        maxCount: Math.max(4, phonemes.length + 1),
      },
      answer: { acceptedSequences: [phonemes.map((c) => c.toLowerCase())] },
    };
  },

  // Tap the letters that make the pattern in a word.
  find_pattern(params, ctx) {
    const pattern = needPattern(ctx, str(params, "pattern"));
    const target = needWord(ctx, str(params, "word"));
    if (pattern.pattern.includes("_")) throw new TemplateError(`${pattern.code} is split; use pick_word_with_pattern`);
    const segments = needSegments(target);
    let at = 0;
    let found = -1;
    for (const s of segments) {
      if (s.patternCode === pattern.code) {
        found = at;
        break;
      }
      at += s.grapheme.length;
    }
    if (found === -1) throw new TemplateError(`"${target.word}" does not use ${pattern.code} in its split`);
    return {
      type: "FIND_PATTERN",
      prompt: `Find ${pattern.pattern}`,
      promptSpeech: `${target.word}. Tap the letters that make ${primarySound(pattern).sayAs}.`,
      word: target.word,
      pattern: pattern.code,
      content: { word: target.word.toLowerCase(), emoji: target.emoji || undefined, speech: target.word, target: pattern.pattern },
      answer: { accepted: [`${found}-${found + pattern.pattern.length - 1}`] },
    };
  },

  // Read a written word (no audio of the word), tap its picture.
  read_word(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const others = distractorWords(params, ctx, target, { need: ["emoji"] }).map((w) => w.word);
    const words = seededShuffle([target.word, ...others], ctx.seed);
    const options = wordOptions(ctx, words, true);
    if (options.some((o) => !("emoji" in o))) throw new TemplateError("read_word needs words with pictures");
    return {
      type: "PICTURE_MATCH",
      prompt: "Read the word. Tap its picture.",
      promptSpeech: "Read the word, then tap its picture.",
      word: target.word,
      area: "reading",
      pattern: optStr(params, "pattern"),
      content: {
        display: target.word,
        hideOptionText: true,
        options: options.map(({ speech: _speech, ...o }) => ({ ...o, text: undefined, speech: o.text })),
      },
      answer: { accepted: [optionId(target.word)] },
    };
  },

  // Sort words into groups by pattern (sh words / ch words).
  sort_by_pattern(params, ctx) {
    const groups = params.groups;
    if (!Array.isArray(groups) || groups.length < 2) throw new TemplateError('"groups" needs two or more groups');
    const parsed = groups.map((g) => {
      const group = g as Params;
      const pattern = needPattern(ctx, str(group, "pattern"));
      const words = strList(group, "words").map((w) => needWord(ctx, w));
      return { pattern, words };
    });
    const items = seededShuffle(
      parsed.flatMap((g) => g.words.map((w) => ({ id: optionId(w.word), text: w.word, emoji: w.emoji || undefined, speech: w.word }))),
      ctx.seed,
    );
    return {
      type: "SORT",
      prompt: `${parsed.map((g) => g.pattern.pattern).join(" or ")}?`,
      promptSpeech: `Sort the words: ${parsed.map((g) => primarySound(g.pattern).sayAs).join(", or ")}?`,
      pattern: parsed[0].pattern.code,
      content: {
        groups: parsed.map((g) => ({ id: optionId(g.pattern.code), label: g.pattern.pattern.replace("_", "–") })),
        items,
      },
      answer: {
        pairs: parsed.flatMap((g) => g.words.map((w) => [optionId(w.word), optionId(g.pattern.code)])),
      },
    };
  },

  // Sort words by which pronunciation of one pattern they use (TH in thin vs this).
  sort_by_sound(params, ctx) {
    const pattern = needPattern(ctx, str(params, "pattern"));
    if (pattern.sounds.length < 2) throw new TemplateError(`${pattern.code} has only one sound`);
    const words = strList(params, "words").map((w) => needWord(ctx, w));
    const pairs: [string, string][] = words.map((w) => {
      const link = w.patterns.find((p) => p.code === pattern.code);
      const sound = link?.sound ?? pattern.sounds.find((s) => s.primary)!.code;
      if (!pattern.sounds.some((s) => s.code === sound)) throw new TemplateError(`bad sound for ${w.word}`);
      return [optionId(w.word), optionId(sound)];
    });
    const used = new Set(pairs.map((p) => p[1]));
    const groups = pattern.sounds.filter((s) => used.has(optionId(s.code)));
    if (groups.length < 2) throw new TemplateError(`the words use only one ${pattern.code} sound`);
    return {
      type: "SORT",
      prompt: `Which ${pattern.pattern} sound?`,
      promptSpeech: `Listen to each word. Which ${pattern.pattern} sound does it have?`,
      pattern: pattern.code,
      content: {
        groups: groups.map((s) => ({ id: optionId(s.code), label: s.label })),
        items: seededShuffle(
          words.map((w) => ({ id: optionId(w.word), text: w.word, emoji: w.emoji || undefined, speech: w.word })),
          ctx.seed,
        ),
      },
      answer: { pairs },
    };
  },

  // Match each pattern to a word that has it.
  match_pattern_word(params, ctx) {
    const pairsIn = params.pairs;
    if (!Array.isArray(pairsIn) || pairsIn.length < 2) throw new TemplateError('"pairs" needs two or more pairs');
    const pairs = pairsIn.map((p) => {
      const pair = p as Params;
      return { pattern: needPattern(ctx, str(pair, "pattern")), word: needWord(ctx, str(pair, "word")) };
    });
    return {
      type: "MATCH",
      prompt: "Match the sound to the word",
      promptSpeech: "Match each pattern to a word that has it.",
      pattern: pairs[0].pattern.code,
      content: {
        left: pairs.map((p) => ({ id: optionId(p.pattern.code), text: p.pattern.pattern, speech: primarySound(p.pattern).sayAs })),
        right: seededShuffle(
          pairs.map((p) => ({ id: `w-${optionId(p.word.word)}`, text: p.word.word, emoji: p.word.emoji || undefined })),
          ctx.seed,
          true,
        ),
      },
      answer: { pairs: pairs.map((p) => [optionId(p.pattern.code), `w-${optionId(p.word.word)}`]) },
    };
  },

  // Match each SOUND (heard, not written) to its letter.
  match_sound_letter(params, ctx) {
    const patterns = strList(params, "patterns").map((c) => needPattern(ctx, c));
    return {
      type: "MATCH",
      prompt: "Match the sound to the letter",
      promptSpeech: "Tap a speaker to hear a sound, then tap its letter.",
      pattern: patterns[0].code,
      content: {
        left: patterns.map((p, i) => ({ id: `sound-${i + 1}`, emoji: "🔊", speech: primarySound(p).sayAs })),
        right: seededShuffle(
          patterns.map((p) => ({ id: optionId(p.pattern), text: p.pattern })),
          ctx.seed,
          true,
        ),
      },
      answer: { pairs: patterns.map((p, i) => [`sound-${i + 1}`, optionId(p.pattern)]) },
    };
  },

  // Build a word from sound tiles (blending): c + a + t → cat.
  build_word(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const chunks = params.chunks === undefined ? [...target.word.toLowerCase()] : strList(params, "chunks");
    if (chunks.join("") !== target.word.toLowerCase())
      throw new TemplateError(`chunks do not spell "${target.word}"`);
    const tiles = seededShuffle([...chunks, ...strList(params, "extra", false)], ctx.seed, true);
    return {
      type: "WORD_BUILDER",
      prompt: "Build the word",
      promptSpeech: target.word,
      word: target.word,
      pattern: optStr(params, "pattern"),
      content: {
        emoji: target.emoji || undefined,
        speech: target.word,
        tiles,
        slots: chunks.length,
        demonstrateBlend: params.demonstrate === true,
      },
      answer: { accepted: [target.word.toLowerCase()] },
    };
  },

  // Put a sentence's words in order.
  order_sentence(params, ctx) {
    const sentence = str(params, "sentence");
    const tokens = sentence.split(/\s+/);
    return {
      type: "SENTENCE_BUILDER",
      prompt: "Put the words in order",
      promptSpeech: sentence,
      content: { emoji: optStr(params, "emoji"), tokens: seededShuffle(tokens, ctx.seed, true) },
      answer: { acceptedSequences: [tokens] },
    };
  },

  // Type the word you hear.
  spell_word(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    return {
      type: "SPELLING",
      prompt: "Type the word you hear",
      promptSpeech: target.word,
      word: target.word,
      area: "spelling",
      content: { emoji: target.emoji || undefined, speech: target.word, hint: optStr(params, "hint") },
      answer: { accepted: [target.word.toLowerCase()] },
    };
  },

  // ---- Vocabulary (Phase 5). Distractors come from the word bank when not listed. ----

  // A picture, choose its word. (Recognition)
  picture_to_word(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const emoji = needEmoji(target);
    const others = distractorWords(params, ctx, target, { need: ["emoji"] }).map((w) => w.word);
    return {
      type: "MULTIPLE_CHOICE",
      prompt: "What is this?",
      promptSpeech: "What is this? Tap the word.",
      word: target.word,
      area: "recognition",
      content: { display: emoji, options: wordOptions(ctx, seededShuffle([target.word, ...others], ctx.seed), false) },
      answer: { accepted: [optionId(target.word)] },
    };
  },

  // A written word, choose its picture (= read_word with bank distractors). (Reading)
  word_to_picture(params, ctx) {
    return TEMPLATES.read_word(params, ctx);
  },

  // Hear a word among look-alike words (cat / cap / cut). (Recognition)
  similar_word(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const others = distractorWords(params, ctx, target, { strategy: "similar" }).map((w) => w.word);
    const words = seededShuffle([target.word, ...others], ctx.seed);
    return {
      type: "LISTEN_AND_CHOOSE",
      prompt: "Tap the word you hear",
      promptSpeech: target.word,
      word: target.word,
      area: "recognition",
      content: { options: wordOptions(ctx, words, false).map(({ speech: _speech, ...o }) => o) },
      answer: { accepted: [optionId(target.word)] },
    };
  },

  // "Which one means: something you drink?" (Meaning)
  meaning_to_word(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const meaning = needDefinition(target);
    const withPictures = pictures(ctx) && !!target.emoji;
    const others = distractorWords(params, ctx, target, {
      strategy: "contrast",
      need: withPictures ? ["definition", "emoji"] : ["definition"],
    }).map((w) => w.word);
    return {
      type: "MULTIPLE_CHOICE",
      prompt: "Which one means…",
      promptSpeech: `Which one means: ${meaning}`,
      word: target.word,
      area: "meaning",
      content: { display: meaning, options: wordOptions(ctx, seededShuffle([target.word, ...others], ctx.seed), withPictures) },
      answer: { accepted: [optionId(target.word)] },
    };
  },

  // Match words to their meanings. (Meaning)
  match_word_meaning(params, ctx) {
    const words = strList(params, "words").map((w) => needWord(ctx, w));
    if (words.length < 2 || words.length > 4) throw new TemplateError("needs two to four words");
    const meanings = words.map((w) => needDefinition(w));
    if (new Set(meanings.map((m) => m.toLowerCase())).size !== meanings.length)
      throw new TemplateError("two words share a meaning");
    if (meanings.some((m) => m.length > 80)) throw new TemplateError("a meaning is too long to match (80 letters)");
    return {
      type: "MATCH",
      prompt: "Match the word to what it means",
      promptSpeech: "Match each word to what it means.",
      area: "meaning",
      content: {
        left: words.map((w) => ({ id: optionId(w.word), text: w.word, speech: w.word })),
        right: seededShuffle(
          words.map((w) => ({ id: `m-${optionId(w.word)}`, text: w.childDefinition, speech: w.childDefinition })),
          ctx.seed,
          true,
        ),
      },
      answer: { pairs: words.map((w) => [optionId(w.word), `m-${optionId(w.word)}`]) },
    };
  },

  // Match words to their pictures. (Recognition)
  match_word_picture(params, ctx) {
    const words = strList(params, "words").map((w) => needWord(ctx, w));
    if (words.length < 2 || words.length > 5) throw new TemplateError("needs two to five words");
    words.forEach(needEmoji);
    if (new Set(words.map((w) => w.emoji)).size !== words.length) throw new TemplateError("two words share a picture");
    return {
      type: "MATCH",
      prompt: "Match the word to its picture",
      promptSpeech: "Match each word to its picture.",
      area: "recognition",
      content: {
        left: words.map((w) => ({ id: optionId(w.word), text: w.word, speech: w.word })),
        right: seededShuffle(
          words.map((w) => ({ id: `p-${optionId(w.word)}`, emoji: w.emoji, speech: w.word })),
          ctx.seed,
          true,
        ),
      },
      answer: { pairs: words.map((w) => [optionId(w.word), `p-${optionId(w.word)}`]) },
    };
  },

  // A letter is missing: c _ t. The gap is a vowel sound by default (from the word's
  // grapheme split, so "sh" in "ship" is one gap, never "s" alone). (Spelling)
  word_missing_letter(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const segments = (target.segments ?? []).filter((s) => s.grapheme.length > 0);
    const given = optStr(params, "missing")?.toLowerCase();
    const segment = given
      ? { grapheme: given }
      : (segments.find((s) => s.grapheme.length === 1 && VOWEL_TILES.includes(s.grapheme) && s.phonemes.length > 0) ??
        segments.find((s) => s.phonemes.length > 0));
    if (!segment) throw new TemplateError(`"${target.word}" has no grapheme split`);
    const missing = segment.grapheme;
    const pool = VOWEL_TILES.includes(missing) ? VOWEL_TILES : CONSONANT_TILES;
    const choices = seededShuffle(pool.filter((c) => c !== missing), ctx.seed).slice(0, 2);
    return {
      ...TEMPLATES.missing_pattern({ word: target.word, missing, choices }, ctx),
      area: "spelling",
    };
  },

  // Build the word from letter tiles, with a few extra letters. (Spelling)
  build_vocab_word(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const letters = [...target.word.toLowerCase()];
    if (!letters.every((l) => /[a-z]/.test(l))) throw new TemplateError(`"${target.word}" has characters that are not letters`);
    if (letters.length > 8) throw new TemplateError(`"${target.word}" is too long to build`);
    const extra = seededShuffle(
      CONSONANT_TILES.concat(VOWEL_TILES).filter((l) => !letters.includes(l)),
      `${ctx.seed}-extra`,
    ).slice(0, (ctx.levelRank ?? 1) >= 4 ? 3 : 2);
    return {
      ...TEMPLATES.build_word({ word: target.word, extra }, ctx),
      area: "spelling",
    };
  },

  // Finish the example sentence with the right word. (Usage)
  complete_sentence(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const { sentence, found } = exampleWith(target, optStr(params, "sentence"));
    const others = distractorWords(params, ctx, target, { strategy: "grammar" }).map((w) => w.word.toLowerCase());
    const answer = found.match.toLowerCase();
    return {
      type: "DRAG_DROP",
      prompt: "Finish the sentence",
      promptSpeech: `Which word finishes the sentence? ${found.before} blank ${found.after}`,
      word: target.word,
      area: "usage",
      sentence,
      content: {
        emoji: target.emoji || undefined,
        parts: [
          ...(found.before.trim() ? [{ text: found.before.trim() }] : []),
          { blank: true },
          ...(found.after.trim() ? [{ text: found.after.trim() }] : []),
        ],
        bank: seededShuffle([answer, ...others], ctx.seed),
      },
      answer: { acceptedSequences: [[answer]] },
    };
  },

  // Which sentence uses the word correctly? "The girl is happy." / "The girl is table."
  // The wrong sentences swap in a word of another kind, so they plainly do not make sense.
  // (Usage — the integration point for the future Sentence Engine: the right option is a
  // sentence-bank row, linked to the question.)
  use_in_sentence(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const { sentence } = exampleWith(target, optStr(params, "sentence"));
    const count = (ctx.levelRank ?? 1) >= 4 ? 2 : 1;
    const wrong = distractorWords(params, ctx, target, { strategy: "nonsense", count }).map((w) => {
      const swapped = swapWord(sentence, target.word, w.word);
      if (!swapped) throw new TemplateError(`cannot swap "${target.word}" in "${sentence}"`);
      return swapped;
    });
    const all = [sentence, ...wrong];
    if (all.some((s) => s.length > 80)) throw new TemplateError("sentence is too long for a choice (80 letters)");
    return {
      type: "MULTIPLE_CHOICE",
      prompt: `Which sentence uses "${target.word}" the right way?`,
      promptSpeech: `${target.word}. Which sentence makes sense?`,
      word: target.word,
      area: "usage",
      sentence,
      content: {
        display: target.emoji ? `${target.emoji} ${target.word}` : target.word,
        options: seededShuffle(all, ctx.seed, true).map((s, i) => ({
          id: s === sentence ? "right" : `wrong-${i + 1}`,
          text: s,
          speech: s,
        })),
      },
      answer: { accepted: ["right"] },
    };
  },

  // Which one belongs in this category? (Meaning)
  pick_category_member(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    if (!target.topCategory) throw new TemplateError(`word "${target.word}" has no category`);
    const name = target.topCategoryName || target.topCategory;
    const withPictures = pictures(ctx) && !!target.emoji;
    const others = distractorWords(params, ctx, target, {
      strategy: "contrast",
      need: withPictures ? ["emoji"] : [],
    });
    if (others.some((w) => w.topCategory === target.topCategory))
      throw new TemplateError("a distractor is in the same category");
    return {
      type: "MULTIPLE_CHOICE",
      prompt: `Which one goes with ${name}?`,
      promptSpeech: `Which one goes with ${name}?`,
      word: target.word,
      area: "meaning",
      content: {
        display: `${target.topCategoryEmoji ?? ""} ${name}`.trim(),
        options: wordOptions(ctx, seededShuffle([target.word, ...others.map((w) => w.word)], ctx.seed), withPictures),
      },
      answer: { accepted: [optionId(target.word)] },
    };
  },

  // Three words from one category and one that does not belong. (Meaning)
  odd_one_out(params, ctx) {
    const words = strList(params, "words").map((w) => needWord(ctx, w));
    if (words.length < 3) throw new TemplateError("needs three words from one category");
    const category = sameTopCategory(words);
    const oddText = optStr(params, "odd");
    const odd = oddText
      ? needWord(ctx, oddText)
      : distractorWords({}, ctx, words[0], {
          strategy: "contrast",
          count: 1,
          need: pictures(ctx) ? ["emoji"] : [],
        })[0];
    if (odd.topCategory === category.code) throw new TemplateError(`"${odd.word}" is in the same category`);
    const withPictures = pictures(ctx) && [...words, odd].every((w) => !!w.emoji);
    return {
      type: "MULTIPLE_CHOICE",
      prompt: "Which one does not belong?",
      promptSpeech: "Which one does not belong?",
      area: "meaning",
      content: {
        options: wordOptions(ctx, seededShuffle([...words.slice(0, 3), odd].map((w) => w.word), ctx.seed), withPictures),
      },
      answer: { accepted: [optionId(odd.word)] },
    };
  },

  // Sort words into their category and another one chosen from the bank. (Meaning)
  sort_by_category(params, ctx) {
    const words = strList(params, "words").map((w) => needWord(ctx, w));
    if (words.length < 2) throw new TemplateError("needs two or more words");
    const category = sameTopCategory(words);
    const mine = words.slice(0, 3);
    if (!ctx.words) throw new TemplateError("sorting needs the word bank");
    const theirs = pickContrastGroup(words[0], ctx.words(), {
      count: mine.length,
      need: pictures(ctx) ? ["emoji"] : [],
      levelRank: ctx.levelRank,
      seed: ctx.seed,
    });
    const otherCategory = theirs[0].topCategory!;
    const otherName = theirs[0].topCategoryName || otherCategory;
    const group = (code: string) => `g-${optionId(code)}`;
    return {
      type: "SORT",
      prompt: `${category.name} or ${otherName}?`,
      promptSpeech: `Sort the words: ${category.name}, or ${otherName}?`,
      area: "meaning",
      content: {
        groups: [
          { id: group(category.code), label: category.name, emoji: category.emoji || undefined },
          { id: group(otherCategory), label: otherName, emoji: theirs[0].topCategoryEmoji || undefined },
        ],
        items: seededShuffle(
          [...mine, ...theirs].map((w) => ({ id: optionId(w.word), text: w.word, emoji: w.emoji || undefined, speech: w.word })),
          ctx.seed,
        ),
      },
      answer: {
        pairs: [
          ...mine.map((w) => [optionId(w.word), group(category.code)]),
          ...theirs.map((w) => [optionId(w.word), group(otherCategory)]),
        ],
      },
    };
  },
};

export function expandTemplate(name: string, params: Params, ctx: TemplateContext): ExpandedQuestion {
  const expander = TEMPLATES[name];
  if (!expander) throw new TemplateError(`unknown template "${name}"`);
  const question = expander(params, ctx);
  // Drop undefined keys so stored JSON is clean and stable across imports.
  return JSON.parse(JSON.stringify(question)) as ExpandedQuestion;
}
