import { z } from "zod";
import { INPUT_METHODS, type InputMethod } from "@/lib/learning/rules";

// Structured configuration for an activity (activities.config). Every activity type has
// a strict schema: unknown keys and wrong values are rejected by the importer before
// anything is published, and the lesson loader validates again on load. The database
// also enforces the one rule that protects scoring (maxTries is 1–3).

const common = {
  // Tries before the answer is revealed (default: the engine rule, 2).
  maxTries: z.number().int().min(1).max(3).optional(),
};

export const passageSchema = z.object({
  title: z.string().trim().max(80).optional(),
  text: z.string().trim().min(1).max(1500),
  emoji: z.string().max(16).optional(),
});

const baseConfigSchema = z.object(common).strict();

// A reading text of the story library (stories.code). The lesson loader turns it into the
// passage the questions are about (lesson-payload.ts → ReadingPassage).
const storyCode = z.string().regex(/^[a-z0-9-]{2,80}$/);
const storyConfigSchema = z.object({ ...common, story: storyCode.optional() }).strict();

// Spelling activities can choose their input method, hints and dictation replays; anything
// left out comes from the level's spelling rules (rules.ts → spelling.levels).
const spellingConfigSchema = z
  .object({
    ...common,
    input: z.enum(INPUT_METHODS).optional(),
    replayLimit: z.number().int().min(1).max(10).optional(),
    slowReplay: z.boolean().optional(),
    maxHints: z.number().int().min(0).max(4).optional(),
  })
  .strict();

const tracingConfigSchema = z.object({ ...common, showModel: z.boolean().default(true) }).strict();

// Typed writing: `checklist` shows the writing checklist (capital, spaces, end mark) while
// writing; `wordBank` false hides the question's word bank (less scaffolding).
const writingConfigSchema = z
  .object({ ...common, checklist: z.boolean().default(true), wordBank: z.boolean().default(true) })
  .strict();

export const activityConfigSchemas = {
  INTRO: z.object({}).strict(),
  MULTIPLE_CHOICE: baseConfigSchema,
  LISTEN_AND_CHOOSE: baseConfigSchema,
  PICTURE_MATCH: baseConfigSchema,
  MISSING_LETTER: spellingConfigSchema,
  WORD_BUILDER: spellingConfigSchema,
  SENTENCE_BUILDER: baseConfigSchema,
  SPELLING: spellingConfigSchema,
  SENTENCE_DICTATION: spellingConfigSchema,
  MATCH: storyConfigSchema,
  SORT: baseConfigSchema,
  DRAG_DROP: baseConfigSchema,
  // A passage the child reads (and can listen to) before answering its questions: a short
  // inline passage, or a story of the library.
  READING: z
    .object({
      ...common,
      passage: passageSchema.optional(),
      story: storyCode.optional(),
      readAloud: z.boolean().default(true),
    })
    .strict()
    .refine((c) => !!c.passage !== !!c.story, { message: "a reading activity needs a passage or a story" }),
  // Reading a story (guided reading): the text itself, not a question.
  READ_PASSAGE: z.object({ story: storyCode }).strict(),
  SELECT_ALL: storyConfigSchema,
  ORDER_EVENTS: storyConfigSchema,
  WRITING: baseConfigSchema,
  BLEND_SOUNDS: baseConfigSchema,
  SEGMENT_WORD: baseConfigSchema,
  FIND_PATTERN: baseConfigSchema,
  // showModel: animate the letter being written before the child traces it.
  TRACING: tracingConfigSchema,
  // Writing engine (Phase 8). The activity type picks the configuration; its questions may
  // be of a different (reused) question type: a WORD_COPY activity holds SPELLING questions
  // in copy mode, a SENTENCE_BUILD activity SENTENCE_BUILDER questions, and so on.
  LETTER_WRITING: tracingConfigSchema,
  SOUND_TO_LETTER: z
    .object({ ...common, showModel: z.boolean().default(false), input: z.enum(INPUT_METHODS).optional(), maxHints: z.number().int().min(0).max(4).optional() })
    .strict(),
  WORD_COPY: spellingConfigSchema,
  WORD_BUILD: spellingConfigSchema,
  IMAGE_TO_WORD: spellingConfigSchema,
  SENTENCE_BUILD: baseConfigSchema,
  SENTENCE_COPY: writingConfigSchema,
  SENTENCE_COMPLETION: writingConfigSchema,
  SENTENCE_WRITING: writingConfigSchema,
  GUIDED_WRITING: writingConfigSchema,
  PARAGRAPH_WRITING: writingConfigSchema,
  STORY_ORDER_WRITING: z.object({ ...common, story: storyCode.optional(), showStory: z.boolean().default(true) }).strict(),
  EDIT_AND_CORRECT: writingConfigSchema,
} as const;

export type ActivityConfigType = keyof typeof activityConfigSchemas;
export type ActivityConfig = {
  maxTries?: number;
  input?: InputMethod;
  replayLimit?: number;
  slowReplay?: boolean;
  maxHints?: number;
  passage?: z.infer<typeof passageSchema>;
  story?: string;
  readAloud?: boolean;
  showModel?: boolean;
  showStory?: boolean;
  checklist?: boolean;
  wordBank?: boolean;
};

export type ParseActivityConfigResult = { ok: true; config: ActivityConfig } | { ok: false; error: string };

export function parseActivityConfig(type: string, config: unknown): ParseActivityConfigResult {
  if (!Object.hasOwn(activityConfigSchemas, type)) {
    return { ok: false, error: `no configuration schema for activity type ${type}` };
  }
  const parsed = activityConfigSchemas[type as ActivityConfigType].safeParse(config ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; "),
    };
  }
  return { ok: true, config: parsed.data as ActivityConfig };
}
