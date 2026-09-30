import { z } from "zod";

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

export const activityConfigSchemas = {
  INTRO: z.object({}).strict(),
  MULTIPLE_CHOICE: baseConfigSchema,
  LISTEN_AND_CHOOSE: baseConfigSchema,
  PICTURE_MATCH: baseConfigSchema,
  MISSING_LETTER: baseConfigSchema,
  WORD_BUILDER: baseConfigSchema,
  SENTENCE_BUILDER: baseConfigSchema,
  SPELLING: baseConfigSchema,
  MATCH: baseConfigSchema,
  SORT: baseConfigSchema,
  DRAG_DROP: baseConfigSchema,
  // A passage the child reads (and can listen to) before answering its questions.
  READING: z.object({ ...common, passage: passageSchema, readAloud: z.boolean().default(true) }).strict(),
  WRITING: baseConfigSchema,
  // showModel: animate the letter being written before the child traces it.
  TRACING: z.object({ ...common, showModel: z.boolean().default(true) }).strict(),
} as const;

export type ActivityConfigType = keyof typeof activityConfigSchemas;
export type ActivityConfig = {
  maxTries?: number;
  passage?: z.infer<typeof passageSchema>;
  readAloud?: boolean;
  showModel?: boolean;
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
