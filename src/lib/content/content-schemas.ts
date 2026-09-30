import { z } from "zod";

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
  wordCategories: z.array(
    z.object({ code, name: z.string(), emoji: z.string().default(""), sortOrder: z.number().int() }),
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
        status,
      }),
    )
    .default([]),
  // Overrides of the engine rules (src/lib/learning/rules.ts), validated on import.
  rules: z
    .array(
      z.object({
        code: z.enum(["mastery", "prerequisites", "review", "player", "scoring"]),
        description: z.string().default(""),
        config: z.record(z.unknown()),
      }),
    )
    .default([]),
});
export type ReferenceFile = z.infer<typeof referenceFileSchema>;

export const phonicsFileSchema = z.object({
  patterns: z.array(
    z.object({
      code,
      pattern: z.string().regex(/^[a-z]{1,8}$/),
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
      status,
      sounds: z
        .array(
          z.object({
            code,
            ipa: z.string().default(""),
            label: z.string().min(1).max(80),
            sayAs: z.string().min(1).max(40),
            primary: z.boolean().default(false),
          }),
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

// One word, as produced from a words.csv row (see parseWordRow) or a JSON import.
export const wordSchema = z.object({
  word: z.string().trim().min(1).max(40),
  sense: z.number().int().min(1).max(9).default(1),
  level: code,
  category: code.optional(),
  difficulty,
  partOfSpeech: z.enum(PARTS_OF_SPEECH).default("noun"),
  syllables: z.number().int().min(1).max(8).default(1),
  pronunciation: z.string().default(""),
  definition: z.string().default(""),
  childDefinition: z.string().default(""),
  exampleSentence: z.string().default(""),
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
  status,
});
export type WordInput = z.infer<typeof wordSchema>;

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
  promptSpeech: z.string().max(300).default(""),
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
  introSpeech: z.string().max(400).default(""),
  // Lessons (by code, any level) to complete first. Skill prerequisites also apply.
  prerequisites: z.array(slug).default([]),
  status,
  activities: z.array(activityInputSchema).min(1),
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
