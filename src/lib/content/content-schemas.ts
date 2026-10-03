import { z } from "zod";
import { findUnsafeSpeech } from "@/lib/audio/pronunciation";

// Schemas for the content files in /content (and for CMS/API imports). Natural keys
// (`code`, a word's text) make imports idempotent: re-importing updates rows in place.
// Cross-references are by code (level "KG2", pattern "SH", word "ship") and are resolved
// by the importer, which reports anything it cannot resolve.

const code = z.string().regex(/^[A-Z0-9_]{1,40}$/, "codes are UPPER_SNAKE_CASE");
const slug = z.string().regex(/^[a-z0-9-]{2,80}$/, "codes are lower-kebab-case");
const status = z.enum(["draft", "published", "archived"]).default("published");
const difficulty = z.number().int().min(1).max(10);

export const levelSchema = z.object({
  code,
  name: z.string().min(1).max(80),
  shortName: z.string().min(1).max(16),
  description: z.string().default(""),
  sortOrder: z.number().int(),
  minAge: z.number().int().min(2).max(18),
  maxAge: z.number().int().min(2).max(18),
  difficulty,
  vocabularyTarget: z.number().int().min(0).default(0),
  sightWordTarget: z.number().int().min(0).default(0),
  maxSentenceWords: z.number().int().min(0).default(0),
  phonicsScope: z.string().default(""),
  readingComplexity: z.string().default(""),
  writingComplexity: z.string().default(""),
  assessmentDifficulty: z.number().int().min(1).max(10).default(1),
  themeEmoji: z.string().default(""),
  status,
});

export const referenceFileSchema = z.object({
  levels: z.array(levelSchema),
  subjects: z.array(
    z.object({
      code,
      name: z.string(),
      description: z.string().default(""),
      emoji: z.string().default(""),
      sortOrder: z.number().int(),
      status,
    }),
  ),
  skillDimensions: z.array(
    z.object({ code, name: z.string(), description: z.string().default(""), sortOrder: z.number().int() }),
  ),
  activityTypes: z.array(
    z.object({ code, name: z.string(), description: z.string().default(""), isScored: z.boolean() }),
  ),
  // Configurable categories; `parent` makes a sub-category (one level deep).
  wordCategories: z.array(
    z.object({
      code,
      name: z.string().min(1).max(60),
      emoji: z.string().default(""),
      description: z.string().max(200).default(""),
      parent: code.optional(),
      sortOrder: z.number().int(),
      status,
    }),
  ),
  achievements: z.array(
    z.object({
      code: slug,
      title: z.string(),
      description: z.string().default(""),
      emoji: z.string().default(""),
      criteria: z.object({ type: z.string(), threshold: z.number().int().positive() }),
      sortOrder: z.number().int(),
      status,
    }),
  ),
  // What the lesson player says after an answer and at the end ("{answer}" = the answer).
  feedback: z
    .array(
      z.object({
        code: slug,
        kind: z.enum(["CORRECT", "INCORRECT", "TRY_AGAIN", "ALMOST_CORRECT", "COMPLETED"]),
        text: z.string().min(1).max(120),
        speech: z.string().max(200).default(""),
        emoji: z.string().default(""),
        // Said after a spelling mistake of this category (spelling.ts).
        errorCategory: code.optional(),
        status,
      }),
    )
    .default([]),
  // Spelling types (CVC, DIGRAPH, HIGH_FREQUENCY …) — an extensible list.
  spellingTypes: z
    .array(
      z.object({
        code,
        name: z.string().min(1).max(80),
        childName: z.string().max(80).default(""),
        description: z.string().max(400).default(""),
        emoji: z.string().default(""),
        sortOrder: z.number().int(),
        status,
      }),
    )
    .default([]),
  // Overrides of the engine rules (src/lib/learning/rules.ts), validated on import.
  rules: z
    .array(
      z.object({
        code: z.enum(["mastery", "prerequisites", "review", "player", "scoring", "vocabulary", "spelling"]),
        description: z.string().default(""),
        config: z.record(z.unknown()),
      }),
    )
    .default([]),
});
export type ReferenceFile = z.infer<typeof referenceFileSchema>;

const phonemeCode = z.string().regex(/^[A-Z]{1,3}$/, "phoneme codes are ARPAbet, e.g. SH, AE");

const SOUND_QUALITIES = ["pure", "approximate", "keyword"] as const;
const KEYWORD_POSITIONS = ["first", "middle", "last"] as const;
const audioPath = z
  .string()
  .regex(/^audio\/[a-z0-9/_-]+\.(mp3|m4a|ogg|wav)$/, "audio must be audio/…/name.mp3");
// One to four lowercase words that have the sound, in order of preference.
const keywordWord = z
  .string()
  .regex(/^[a-z]{2,20}( [a-z]{2,20}){0,3}$/, "keywords are 1–4 lowercase words, space-separated");
const speechRendering = z
  .string()
  .max(40)
  .default("")
  .refine(
    (t) => findUnsafeSpeech(t).length === 0,
    (t) => ({ message: `speech engines read "${findUnsafeSpeech(t).join(", ")}" as letter names` }),
  );
// Authored speech: sounds and letter names are written as tokens ({/SH/}, {@s}); a bare
// letter group ("sh", "sss") is ambiguous and is read by voices as letter names.
const safeSpeech = (max: number) =>
  z
    .string()
    .max(max)
    .default("")
    .refine(
      (t) => findUnsafeSpeech(t).length === 0,
      (t) => ({
        message: `"${findUnsafeSpeech(t).join(", ")}" would be read as letter names: write {/SH/} for a sound or {@s} {@h} for letters`,
      }),
    );
const hasRendering = (x: { sayAs: string; ttsQuality: string; keyword?: string }) =>
  x.ttsQuality === "keyword" ? !!x.keyword : x.sayAs !== "";
const renderingMessage = "a sound needs a rendering (sayAs) or, with ttsQuality keyword, a keyword";

export const phonicsFileSchema = z.object({
  // The sound inventory (American English). Pronunciations below are sequences of these.
  phonemes: z
    .array(
      z.object({
        code: phonemeCode,
        ipa: z.string().min(1).max(12),
        label: z.string().min(1).max(8),
        // What speech synthesis says for the sound (see src/lib/audio/pronunciation.ts):
        // never letters ("sss", "th"), which voices read as letter names.
        sayAs: speechRendering,
        ttsQuality: z.enum(SOUND_QUALITIES).default("approximate"),
        // A word that has the sound, used when there is no safe rendering.
        keyword: keywordWord.optional(),
        keywordPosition: z.enum(KEYWORD_POSITIONS).default("first"),
        // A recorded clip of the sound (optional; wins over speech synthesis).
        audio: audioPath.optional(),
        kind: z.enum(["consonant", "vowel", "r_colored_vowel"]),
        voiced: z.boolean(),
        example: z.string().default(""),
        description: z.string().default(""),
      })
      .refine(hasRendering, renderingMessage),
    )
    .default([]),
  // The progression: Letters → Sounds → Beginning sounds → … → Advanced patterns.
  stages: z
    .array(
      z.object({
        code,
        name: z.string().min(1).max(80),
        childName: z.string().default(""),
        description: z.string().default(""),
        emoji: z.string().default(""),
      }),
    )
    .default([]),
  patterns: z.array(
    z.object({
      code,
      pattern: z.string().regex(/^[a-z][a-z_]{0,7}$/),
      type: z.enum([
        "letter",
        "consonant_digraph",
        "consonant_blend",
        "trigraph",
        "vowel_team",
        "r_controlled",
        "silent_e",
        "word_ending",
        "suffix",
        "prefix",
      ]),
      level: code,
      difficulty,
      explanation: z.string().default(""),
      childExplanation: z.string().default(""),
      masteryThreshold: z.number().int().min(50).max(100).default(85),
      sortOrder: z.number().int().default(0),
      stage: code.optional(),
      position: z.enum(["any", "initial", "medial", "final"]).default("any"),
      // Letters: the capital form and the letter's name (not its sound).
      uppercase: z.string().regex(/^[A-Z]{1,2}$/).optional(),
      letterName: z.string().max(20).default(""),
      letterNameSayAs: z.string().max(40).default(""),
      // Recorded audio in Supabase Storage (optional; speech synthesis is the fallback).
      audio: z.string().regex(/^audio\/[a-z0-9/_-]+\.(mp3|m4a|ogg|wav)$/, "audio must be audio/…/name.mp3").optional(),
      relations: z
        .array(
          z.object({
            code,
            type: z.enum(["prerequisite", "related", "contrast", "same_sound"]),
          }),
        )
        .default([]),
      status,
      sounds: z
        .array(
          z.object({
            code,
            ipa: z.string().default(""),
            label: z.string().min(1).max(80),
            // Own rendering for a multi-sound pattern ("shun"); empty = from the phonemes.
            sayAs: speechRendering,
            ttsQuality: z.enum(SOUND_QUALITIES).default("approximate"),
            keyword: keywordWord.optional(),
            keywordPosition: z.enum(KEYWORD_POSITIONS).default("first"),
            primary: z.boolean().default(false),
            phonemes: z.array(phonemeCode).min(1, "a sound needs its phonemes"),
          })
          .refine((x) => x.ttsQuality !== "keyword" || !!x.keyword, "a keyword sound needs its keyword"),
        )
        .min(1)
        .refine((s) => s.filter((x) => x.primary).length === 1, "exactly one sound must be primary"),
    }),
  ),
});
export type PhonicsFile = z.infer<typeof phonicsFileSchema>;

export const PARTS_OF_SPEECH = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "preposition",
  "conjunction",
  "determiner",
  "interjection",
  "number",
  "other",
] as const;

// Grammatical forms a word can list (CSV `inflections`: "past=jumped;ing=jumping").
export const INFLECTION_KEYS = [
  "plural",
  "past",
  "past_participle",
  "ing",
  "third_person",
  "comparative",
  "superlative",
] as const;

// One word, as produced from a words.csv row (see parseWordRow) or a JSON import.
export const wordSchema = z.object({
  word: z
    .string()
    .trim()
    .min(1)
    .max(40)
    // One written word: letters and apostrophes (every letter must belong to a grapheme of
    // its split, so spaces and hyphens cannot be stored).
    .regex(/^[A-Za-z][A-Za-z']*$/, "a word uses letters (and apostrophes) only"),
  sense: z.number().int().min(1).max(9).default(1),
  // The level that introduces the word; `levels` lists further levels it suits.
  level: code,
  levels: z.array(code).default([]),
  category: code.optional(),
  subcategory: code.optional(),
  difficulty,
  partOfSpeech: z.enum(PARTS_OF_SPEECH).default("noun"),
  syllables: z.number().int().min(1).max(8).default(1),
  pronunciation: z.string().default(""),
  definition: z.string().default(""),
  childDefinition: z.string().default(""),
  exampleSentence: z.string().max(300).default(""),
  // More curated example sentences (CSV `examples`, separated by |).
  examples: z.array(z.string().trim().min(2).max(300)).max(5).default([]),
  sightWord: z.boolean().default(false),
  irregular: z.boolean().default(false),
  spellingNote: z.string().default(""),
  plural: z.string().default(""),
  emoji: z.string().default(""),
  tags: z.array(z.string().min(1).max(40)).default([]),
  // Phonics patterns in the word, optionally with the sound used and whether the word is
  // a featured example of that pattern.
  patterns: z
    .array(z.object({ code, sound: code.optional(), example: z.boolean().default(false) }))
    .default([]),
  related: z.array(z.string().min(1).max(40)).default([]),
  synonyms: z.array(z.string().min(1).max(40)).default([]),
  antonyms: z.array(z.string().min(1).max(40)).default([]),
  inflections: z.record(z.enum(INFLECTION_KEYS), z.string().trim().min(1).max(40)).default({}),
  // Storage paths of an already uploaded picture / recording (image_assets / audio_assets).
  image: z.string().trim().max(200).optional(),
  audio: z.string().trim().max(200).optional(),
  // Authored grapheme split when the automatic one would be wrong: "c a=A_LONG k e=".
  segments: z.string().max(120).optional(),
  status,
});
export type WordInput = z.infer<typeof wordSchema>;

// A spelling target: the spelling view of a word of the word bank (content/spelling/*.csv).
// The word itself (text, split, meaning, syllables) is never repeated here.
export const spellingWordSchema = z.object({
  word: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z][A-Za-z']*$/, "a word uses letters (and apostrophes) only"),
  sense: z.number().int().min(1).max(9).default(1),
  // The level at which the word is a spelling target.
  level: code,
  // The spelling skill it belongs to (a skill code from the curriculum), optional.
  skill: slug.optional(),
  spellingType: code,
  difficulty,
  // The phonics pattern the word practises when spelled (SH for ship).
  phonicsPattern: code.optional(),
  // Storage path of a recording for dictation (audio_assets).
  audio: z.string().trim().max(200).optional(),
  // A dictation / "use it" sentence; default the word's example sentence.
  exampleSentence: z.string().trim().max(300).optional(),
  isHighFrequency: z.boolean().default(false),
  isIrregular: z.boolean().default(false),
  // The irregular part as written ("ai" in said); needs isIrregular.
  irregularPart: z.string().regex(/^[a-z]{1,8}$/).optional(),
  hints: z.array(z.string().trim().min(2).max(120)).max(3).default([]),
  commonErrors: z.array(z.string().regex(/^[a-z']{1,40}$/)).max(6).default([]),
  tags: z.array(z.string().min(1).max(40)).default([]),
  status,
});
export type SpellingWordInput = z.infer<typeof spellingWordSchema>;

// content/vocabulary.json: word families. Members are found in the word bank from each
// word's grapheme split (src/lib/content/vocabulary.ts → familyMembers); `words` adds
// members the rule cannot find and `exclude` removes ones it should not take.
export const vocabularyFileSchema = z.object({
  families: z.array(
    z.object({
      code,
      rime: z.string().regex(/^[a-z]{1,6}$/),
      title: z.string().min(1).max(80),
      level: code,
      vowelPattern: code.optional(),
      // The vowel sound of the family (a sound code of vowelPattern, default its primary).
      vowelSound: code.optional(),
      emoji: z.string().default(""),
      sortOrder: z.number().int().default(0),
      words: z.array(z.string().min(1).max(40)).default([]),
      exclude: z.array(z.string().min(1).max(40)).default([]),
      status,
    }),
  ),
});

export const sightWordsFileSchema = z.object({
  lists: z.array(
    z.object({ level: code, listName: z.string().default("core"), words: z.array(z.string().min(1)) }),
  ),
});

export const sentencesFileSchema = z.object({
  sentences: z.array(
    z.object({
      text: z.string().min(2).max(300),
      level: code,
      difficulty,
      grammarComplexity: z.number().int().min(1).max(5).default(1),
      emoji: z.string().default(""),
      patterns: z.array(code).default([]),
      status,
    }),
  ),
});

export const storiesFileSchema = z.object({
  stories: z.array(
    z.object({
      code: slug,
      title: z.string().min(1).max(120),
      level: code,
      difficulty,
      summary: z.string().default(""),
      coverEmoji: z.string().default(""),
      pages: z.array(z.object({ text: z.string().min(1), emoji: z.string().optional() })).min(1),
      isOriginal: z.boolean().default(true),
      license: z.string().default(""),
      status,
    }),
  ),
});

// A question is either raw (type + content + answer, validated by question-schemas.ts)
// or a template the importer expands using the word bank (see templates.ts).
export const rawQuestionSchema = z.object({
  code: slug.optional(),
  type: z.string(),
  prompt: z.string().max(300).default(""),
  promptSpeech: safeSpeech(300),
  explanation: z.string().max(300).default(""),
  metadata: z.record(z.unknown()).default({}),
  content: z.record(z.unknown()).default({}),
  answer: z.record(z.unknown()).nullable().default(null),
  word: z.string().optional(),
  pattern: code.optional(),
  story: slug.optional(),
  // Assessment questions may measure a different skill than their stage's default.
  skill: slug.optional(),
  difficulty: difficulty.default(1),
});

export const templateQuestionSchema = z
  .object({
    code: slug.optional(),
    template: z.string(),
    skill: slug.optional(),
    difficulty: difficulty.default(1),
    explanation: z.string().max(300).default(""),
  })
  .passthrough();

export const questionInputSchema = z.union([rawQuestionSchema, templateQuestionSchema]);
export type QuestionInput = z.infer<typeof questionInputSchema>;

const activityInputSchema = z.object({
  code: slug.optional(),
  type: code,
  stage: z.enum(["explanation", "demonstration", "guided_practice", "independent_practice", "review"]),
  title: z.string().min(1).max(120),
  instructions: z.string().default(""),
  instructionsSpeech: z.string().default(""),
  config: z.record(z.unknown()).default({}),
  status,
  questions: z.array(questionInputSchema).min(1),
});

const lessonInputSchema = z.object({
  code: slug,
  title: z.string().min(1).max(120),
  childTitle: z.string().default(""),
  description: z.string().default(""),
  emoji: z.string().default(""),
  minutes: z.number().int().min(1).max(60).default(5),
  difficulty: difficulty.default(1),
  // Read aloud on the lesson's intro screen.
  introSpeech: safeSpeech(400),
  // Lessons (by code, any level) to complete first. Skill prerequisites also apply.
  prerequisites: z.array(slug).default([]),
  status,
  // Either activities, or a blueprint the importer expands into them
  // (src/lib/content/lesson-blueprints.ts).
  blueprint: z.object({ name: z.string() }).passthrough().optional(),
  activities: z.array(activityInputSchema).default([]),
}).refine((l) => l.activities.length > 0 || l.blueprint, {
  message: "a lesson needs activities or a blueprint",
});

const skillInputSchema = z.object({
  code: slug,
  dimension: code,
  title: z.string().min(1).max(120),
  childTitle: z.string().default(""),
  description: z.string().default(""),
  pattern: code.optional(),
  masteryThreshold: z.number().int().min(50).max(100).default(90),
  importance: z.number().int().min(1).max(5).default(3),
  difficulty: difficulty.default(1),
  active: z.boolean().default(true),
  prerequisites: z.array(slug).default([]),
  // Phonics stage for grouping phonics progress (LETTER_SOUNDS, DIGRAPHS, ...).
  phonicsStage: code.optional(),
  status,
  lessons: z.array(lessonInputSchema).default([]),
});

export const curriculumFileSchema = z.object({
  level: code,
  units: z.array(
    z.object({
      code: slug,
      subject: code,
      title: z.string().min(1).max(120),
      description: z.string().default(""),
      emoji: z.string().default(""),
      status,
      skills: z.array(skillInputSchema).min(1),
    }),
  ),
});
export type CurriculumFile = z.infer<typeof curriculumFileSchema>;

export const assessmentsFileSchema = z.object({
  assessments: z.array(
    z.object({
      code: slug,
      title: z.string(),
      description: z.string().default(""),
      type: z.enum(["placement", "level_check", "skill_check"]),
      level: code.optional(),
      config: z.record(z.unknown()).default({}),
      status,
      stages: z.array(
        z.object({
          stage: z.number().int().min(1),
          label: z.string(),
          // Questions are attached to this skill for mastery/assessment breakdowns.
          skill: slug,
          questions: z.array(questionInputSchema).min(1),
        }),
      ),
    }),
  ),
});
