// Question templates: short, readable authoring forms that the importer expands into full
// questions using the word bank and phonics patterns. A template never invents content:
// pictures, definitions and sounds all come from the stored words and patterns, so fixing
// a word fixes every question built from it.
//
//   { "template": "missing_pattern", "word": "ship", "pattern": "SH", "choices": ["sh", "ch", "th"] }
//
// See docs/curriculum.md → "Authoring content" for the full list and examples.

export type TemplateWord = {
  word: string;
  emoji: string;
  childDefinition: string;
  patterns: { code: string; sound?: string }[];
};

export type TemplatePattern = {
  code: string;
  pattern: string;
  type: string;
  childExplanation: string;
  sounds: { code: string; label: string; sayAs: string; primary: boolean }[];
};

export type TemplateContext = {
  word: (text: string) => TemplateWord | undefined;
  pattern: (code: string) => TemplatePattern | undefined;
  // Deterministic seed (the question code), so re-imports produce identical content.
  seed: string;
};

export type ExpandedQuestion = {
  type: string;
  prompt: string;
  promptSpeech: string;
  content: Record<string, unknown>;
  answer: Record<string, unknown> | null;
  word?: string;
  pattern?: string;
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
function displayPattern(p: TemplatePattern) {
  return p.type === "letter" ? `${p.pattern.toUpperCase()} ${p.pattern}` : p.pattern;
}

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
    const words = seededShuffle([target.word, ...strList(params, "distractors")], ctx.seed);
    return {
      type: "LISTEN_AND_CHOOSE",
      prompt: "Find the picture",
      promptSpeech: target.word,
      word: target.word,
      content: { hideOptionText: params.showText !== true, options: wordOptions(ctx, words, true) },
      answer: { accepted: [optionId(target.word)] },
    };
  },

  // Hear a word, tap it written (reading, no pictures).
  listen_pick_word(params, ctx) {
    const target = needWord(ctx, str(params, "word"));
    const words = seededShuffle([target.word, ...strList(params, "distractors")], ctx.seed);
    return {
      type: "LISTEN_AND_CHOOSE",
      prompt: "Tap the word you hear",
      promptSpeech: target.word,
      word: target.word,
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

  // Find a letter among look-alikes.
  find_letter(params, ctx) {
    const pattern = needPattern(ctx, str(params, "pattern"));
    const upper = params.case === "upper";
    const show = (l: string) => (upper ? l.toUpperCase() : l.toLowerCase());
    const letters = seededShuffle([pattern.pattern, ...strList(params, "distractors")], ctx.seed);
    return {
      type: "MULTIPLE_CHOICE",
      prompt: `Find the letter ${show(pattern.pattern)}`,
      promptSpeech: `Find the ${upper ? "big" : "small"} letter ${pattern.pattern}`,
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
      content: { emoji: target.emoji || undefined, speech: target.word, hint: optStr(params, "hint") },
      answer: { accepted: [target.word.toLowerCase()] },
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
