// Lesson blueprints: reusable lesson structures. A curriculum file can describe a phonics
// lesson in a few lines —
//
//   { "code": "kg3-sh-1", "title": "The sh sound", "blueprint": {
//       "name": "phonics_pattern", "pattern": "SH",
//       "words": ["ship", "fish", "shell", "shop", "dish", "shoe"],
//       "contrast": { "pattern": "CH", "words": ["chip", "chin"] },
//       "sentence": "The fish is in the dish." } }
//
// — and the importer expands it into ordinary activities and template questions, which
// then go through exactly the same validation and import as hand-written ones. Only the
// structure is shared; every word, pattern and sentence is content.

type Question = Record<string, unknown> & { template: string };

export type BlueprintActivity = {
  type: string;
  stage: "explanation" | "demonstration" | "guided_practice" | "independent_practice" | "review";
  title: string;
  instructions: string;
  instructionsSpeech: string;
  questions: Question[];
};

export class BlueprintError extends Error {}

type Params = Record<string, unknown>;

const str = (p: Params, key: string) => {
  const v = p[key];
  if (typeof v !== "string" || !v.trim()) throw new BlueprintError(`blueprint needs "${key}"`);
  return v.trim();
};
const list = (p: Params, key: string, min: number) => {
  const v = p[key];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string") || v.length < min)
    throw new BlueprintError(`blueprint needs "${key}" with at least ${min} entries`);
  return v as string[];
};
const optList = (p: Params, key: string) => (Array.isArray(p[key]) ? (p[key] as string[]) : []);

function activity(
  type: string,
  stage: BlueprintActivity["stage"],
  title: string,
  instructions: string,
  questions: Question[],
): BlueprintActivity {
  return { type, stage, title, instructions, instructionsSpeech: instructions, questions };
}

export const BLUEPRINTS: Record<string, (p: Params) => BlueprintActivity[]> = {
  // One letter: its shapes, name and sound, then hear → find → first sound → spell.
  //   pattern, letter (lowercase), words[3], distractors (letter pattern codes, 2+),
  //   distractorLetters (lowercase, 2+), distractorWords[2]
  letter_sound(p) {
    const pattern = str(p, "pattern");
    const letter = str(p, "letter");
    const words = list(p, "words", 3);
    const distractors = list(p, "distractors", 2);
    const distractorLetters = list(p, "distractorLetters", 2);
    const distractorWords = list(p, "distractorWords", 2);
    // Letters whose sound is heard at the end of words, not the start (x in box).
    const atEnd = p.soundPosition === "end";
    const heard: Question = atEnd
      ? { template: "sound_at_position", word: words[0], position: "end", choices: distractorLetters }
      : { template: "pick_starting_sound", pattern, word: words[0], distractors: distractorWords };
    return [
      activity("INTRO", "explanation", "Meet the letter", "Listen: the letter's name, and its sound.", [
        { template: "letter_intro", pattern, examples: words },
      ]),
      activity("MATCH", "demonstration", "Big and small", "Match the big letters to the small letters.", [
        { template: "match_upper_lower", patterns: [pattern, ...distractors.slice(0, 2)] },
      ]),
      activity("LISTEN_AND_CHOOSE", "guided_practice", "Which letter?", "Listen to the sound, then tap its letter.", [
        { template: "letter_for_sound", pattern, distractors: distractors.slice(0, 2) },
      ]),
      activity(
        atEnd ? "LISTEN_AND_CHOOSE" : "PICTURE_MATCH",
        "guided_practice",
        atEnd ? "Last sound" : "First sound",
        atEnd ? "What sound is at the end?" : "Which picture starts with this sound?",
        [heard],
      ),
      activity("MULTIPLE_CHOICE", "independent_practice", "Find the letter", "Find the letter.", [
        { template: "find_letter", pattern, distractors: distractorLetters, case: "upper" },
        { template: "find_letter", pattern, distractors: distractorLetters },
      ]),
      activity("MISSING_LETTER", "independent_practice", "Missing letter", "Which letter is missing?", [
        { template: "missing_pattern", word: words[1], missing: letter, pattern, choices: distractorLetters },
      ]),
      activity("LISTEN_AND_CHOOSE", "review", "Quick check", "Listen, then tap.", [
        { template: "letter_for_sound", pattern, distractors: distractors.slice(-2) },
        {
          template: "sound_at_position",
          word: words[2],
          position: atEnd ? "end" : "beginning",
          choices: distractorLetters,
        },
      ]),
    ];
  },

  // A short vowel with CVC words: hear → blend → segment → build → read → spell.
  //   pattern (vowel), vowel (letter), words[5] (CVC with that vowel), distractorWords[2],
  //   otherVowels (letters, 2+)
  cvc_blending(p) {
    const pattern = str(p, "pattern");
    const words = list(p, "words", 5);
    const distractorWords = list(p, "distractorWords", 2);
    const otherVowels = list(p, "otherVowels", 2);
    const vowel = str(p, "vowel");
    return [
      activity("INTRO", "demonstration", `Short ${vowel}`, "Listen: sounds join to make a word.", [
        { template: "pattern_intro", pattern, examples: words.slice(0, 3) },
      ]),
      activity("BLEND_SOUNDS", "guided_practice", "Blend it", "Tap each sound, then blend them.", [
        { template: "blend_word", word: words[0], distractors: distractorWords, pattern, pictures: true },
        { template: "blend_word", word: words[1], distractors: [words[2], distractorWords[0]], pattern, pictures: true },
      ]),
      activity("SEGMENT_WORD", "guided_practice", "Count the sounds", "How many sounds? Tap them in order.", [
        { template: "segment_word", word: words[2], pattern },
      ]),
      activity("LISTEN_AND_CHOOSE", "independent_practice", "Middle sound", "What sound is in the middle?", [
        { template: "sound_at_position", word: words[3], position: "middle", choices: otherVowels },
      ]),
      activity("WORD_BUILDER", "independent_practice", "Build the word", "Listen, then put the sounds in order.", [
        { template: "build_word", word: words[3], extra: otherVowels.slice(0, 1), pattern },
      ]),
      activity("PICTURE_MATCH", "independent_practice", "Read it", "Read the word. Tap its picture.", [
        { template: "read_word", word: words[4], distractors: distractorWords, pattern },
      ]),
      activity("SPELLING", "review", "Spell it", "Type the word you hear.", [{ template: "spell_word", word: words[0] }]),
    ];
  },

  // A digraph, vowel team, blend, r-controlled vowel, magic e or ending — the eight-step
  // phonics lesson: hear → see → practise → identify → read → spell → sentence → check.
  //   pattern, words[6+] (all really use the pattern's sound), contrast {pattern, words[2+]},
  //   sentence (uses a pattern word), soundSort: words[] (optional, patterns with 2+ sounds)
  phonics_pattern(p) {
    const pattern = str(p, "pattern");
    const words = list(p, "words", 6);
    const contrast = (p.contrast ?? {}) as Params;
    const contrastPattern = str(contrast, "pattern");
    const contrastWords = list(contrast, "words", 2);
    const contrastGrapheme = str(contrast, "grapheme");
    const own = str(p, "grapheme");
    const split = own.length === 1 && Boolean(p.split);
    const sentence = typeof p.sentence === "string" ? p.sentence : null;
    const soundSort = optList(p, "soundSort");

    const see: Question[] = split
      ? [
          { template: "pick_word_with_pattern", pattern, word: words[0], distractors: contrastWords.slice(0, 2), pictures: true },
        ]
      : [
          { template: "find_pattern", pattern, word: words[0] },
          { template: "find_pattern", pattern, word: words[1] },
        ];
    const out: BlueprintActivity[] = [
      activity("INTRO", "explanation", "Hear it", "Listen to the sound.", [
        { template: "pattern_intro", pattern, examples: words.slice(0, 3) },
      ]),
      activity(split ? "MULTIPLE_CHOICE" : "FIND_PATTERN", "demonstration", "See it", "Find the letters that make the sound.", see),
      activity("LISTEN_AND_CHOOSE", "guided_practice", "Practise it", "Listen, then tap the word.", [
        { template: "listen_pick_word", word: words[2], distractors: contrastWords.slice(0, 2) },
      ]),
      activity("SORT", "guided_practice", "Sort it", "Put each word in the right group.", [
        {
          template: "sort_by_pattern",
          groups: [
            { pattern, words: words.slice(0, 3) },
            { pattern: contrastPattern, words: contrastWords.slice(0, 3) },
          ],
        },
      ]),
    ];
    if (soundSort.length >= 2) {
      out.push(
        activity("SORT", "guided_practice", "Two sounds", "This pattern has more than one sound. Sort by sound.", [
          { template: "sort_by_sound", pattern, words: soundSort },
        ]),
      );
    }
    out.push(
      activity("PICTURE_MATCH", "independent_practice", "Read it", "Read the word. Tap its picture.", [
        { template: "read_word", word: words[3], distractors: [words[4], contrastWords[0]], pattern },
      ]),
      activity("MISSING_LETTER", "independent_practice", "Spell it", "Which letters are missing?", [
        {
          template: "missing_pattern",
          word: words[4],
          missing: own,
          pattern,
          // Magic e: the contrast is the same vowel's short sound, so offer other vowels.
          choices: split ? ["a", "i", "o", "u"].filter((v) => v !== own).slice(0, 2) : [contrastGrapheme],
        },
      ]),
      activity("SPELLING", "independent_practice", "Write it", "Type the word you hear.", [
        { template: "spell_word", word: words[5] },
      ]),
    );
    if (sentence) {
      out.push(
        activity("SENTENCE_BUILDER", "review", "Use it", "Put the words in order.", [
          { template: "order_sentence", sentence, emoji: typeof p.sentenceEmoji === "string" ? p.sentenceEmoji : undefined },
        ]),
      );
    }
    out.push(
      activity("MULTIPLE_CHOICE", "review", "Quick check", "Which word has the sound?", [
        { template: "pick_word_with_pattern", pattern, word: words[1], distractors: contrastWords.slice(0, 2) },
      ]),
    );
    return out;
  },
};

export function expandBlueprint(blueprint: Params): BlueprintActivity[] {
  const name = str(blueprint, "name");
  const expand = BLUEPRINTS[name];
  if (!expand) throw new BlueprintError(`unknown lesson blueprint "${name}"`);
  return expand(blueprint);
}
