import { z } from "zod";

// The contract between stored content and the activity renderers. `questions.content`
// and `questions.answer` are JSON in the database; these schemas validate them on import
// (scripts/content/import.ts) and again when a lesson is loaded, so a malformed question
// is skipped and reported instead of breaking a child's lesson.
//
// Adding a question type = add its schema here, a row in activity_types, an evaluator
// branch in src/lib/learning/evaluate.ts and a renderer in src/features/activities.

const text = (max: number) => z.string().trim().min(1).max(max);

export const choiceOptionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  text: z.string().trim().max(60).optional(),
  emoji: z.string().max(16).optional(),
  // What to say when the option's speaker is tapped (defaults to `text`).
  speech: z.string().trim().max(120).optional(),
});

export const introContentSchema = z.object({
  heading: text(80),
  body: z.string().trim().max(400).default(""),
  speech: z.string().trim().max(400).default(""),
  display: z.string().trim().max(40).optional(),
  examples: z
    .array(
      z.object({
        text: text(40),
        emoji: z.string().max(16).optional(),
        // Letters to highlight inside `text`, e.g. "sh" in "ship".
        highlight: z.string().max(8).optional(),
      }),
    )
    .max(8)
    .default([]),
});

export const choiceContentSchema = z.object({
  // Shown above the options: a letter, a word, or a short passage to read.
  display: z.string().trim().max(300).optional(),
  // Hide option labels so the child must rely on the picture/sound (listen-and-choose).
  hideOptionText: z.boolean().default(false),
  options: z.array(choiceOptionSchema).min(2).max(6),
});

export const missingLetterContentSchema = z
  .object({
    word: text(40),
    emoji: z.string().max(16).optional(),
    parts: z
      .array(z.union([z.object({ text: text(20) }), z.object({ blank: z.literal(true) })]))
      .min(2)
      .max(8),
    choices: z.array(text(8)).min(2).max(6),
  })
  .refine((c) => c.parts.filter((p) => "blank" in p).length === 1, {
    message: "missing-letter content needs exactly one blank part",
  });

export const wordBuilderContentSchema = z.object({
  emoji: z.string().max(16).optional(),
  // What to say as the target word (defaults to the accepted answer).
  speech: z.string().trim().max(60).optional(),
  tiles: z.array(text(8)).min(2).max(12),
  slots: z.number().int().min(1).max(10),
  // Show the tiles joined slowly (C → A → T → CAT) before building.
  demonstrateBlend: z.boolean().default(false),
});

export const sentenceBuilderContentSchema = z.object({
  emoji: z.string().max(16).optional(),
  tokens: z.array(text(24)).min(2).max(14),
});

export const spellingContentSchema = z.object({
  emoji: z.string().max(16).optional(),
  speech: z.string().trim().max(60).optional(),
  hint: z.string().trim().max(120).optional(),
});

export const acceptedAnswerSchema = z.object({
  accepted: z.array(text(120)).min(1).max(10),
});

export const sequenceAnswerSchema = z.object({
  acceptedSequences: z
    .array(z.array(text(24)).min(1).max(14))
    .min(1)
    .max(5),
});

export const valueResponseSchema = z.object({ value: z.string().max(200) });
export const sequenceResponseSchema = z.object({ sequence: z.array(z.string().max(40)).max(20) });
export const responseSchema = z.union([valueResponseSchema, sequenceResponseSchema]);
export type QuestionResponse = z.infer<typeof responseSchema>;

// Each type's content schema, answer schema (null = unscored) and response schema.
export const questionTypeSchemas = {
  INTRO: { content: introContentSchema, answer: null, response: null },
  MULTIPLE_CHOICE: {
    content: choiceContentSchema,
    answer: acceptedAnswerSchema,
    response: valueResponseSchema,
  },
  LISTEN_AND_CHOOSE: {
    content: choiceContentSchema,
    answer: acceptedAnswerSchema,
    response: valueResponseSchema,
  },
  PICTURE_MATCH: {
    content: choiceContentSchema,
    answer: acceptedAnswerSchema,
    response: valueResponseSchema,
  },
  MISSING_LETTER: {
    content: missingLetterContentSchema,
    answer: acceptedAnswerSchema,
    response: valueResponseSchema,
  },
  WORD_BUILDER: {
    content: wordBuilderContentSchema,
    answer: acceptedAnswerSchema,
    response: sequenceResponseSchema,
  },
  SENTENCE_BUILDER: {
    content: sentenceBuilderContentSchema,
    answer: sequenceAnswerSchema,
    response: sequenceResponseSchema,
  },
  SPELLING: { content: spellingContentSchema, answer: acceptedAnswerSchema, response: valueResponseSchema },
} as const;

export type SupportedQuestionType = keyof typeof questionTypeSchemas;

export function isSupportedQuestionType(type: string): type is SupportedQuestionType {
  return Object.hasOwn(questionTypeSchemas, type);
}

export type IntroContent = z.infer<typeof introContentSchema>;
export type ChoiceContent = z.infer<typeof choiceContentSchema>;
export type MissingLetterContent = z.infer<typeof missingLetterContentSchema>;
export type WordBuilderContent = z.infer<typeof wordBuilderContentSchema>;
export type SentenceBuilderContent = z.infer<typeof sentenceBuilderContentSchema>;
export type SpellingContent = z.infer<typeof spellingContentSchema>;
export type AcceptedAnswer = z.infer<typeof acceptedAnswerSchema>;
export type SequenceAnswer = z.infer<typeof sequenceAnswerSchema>;
export type AnswerSpec = AcceptedAnswer | SequenceAnswer;

export type ParsedQuestion =
  | { type: "INTRO"; content: IntroContent; answer: null }
  | {
      type: "MULTIPLE_CHOICE" | "LISTEN_AND_CHOOSE" | "PICTURE_MATCH";
      content: ChoiceContent;
      answer: AcceptedAnswer;
    }
  | { type: "MISSING_LETTER"; content: MissingLetterContent; answer: AcceptedAnswer }
  | { type: "WORD_BUILDER"; content: WordBuilderContent; answer: AcceptedAnswer }
  | { type: "SENTENCE_BUILDER"; content: SentenceBuilderContent; answer: SequenceAnswer }
  | { type: "SPELLING"; content: SpellingContent; answer: AcceptedAnswer };

export type ParseQuestionResult = { ok: true; question: ParsedQuestion } | { ok: false; error: string };

// Validates one question's stored JSON against its type. Also checks cross-field rules
// that a schema alone cannot (a choice answer must name one of the options).
export function parseQuestion(type: string, content: unknown, answer: unknown): ParseQuestionResult {
  if (!isSupportedQuestionType(type)) {
    return { ok: false, error: `unsupported question type ${type}` };
  }
  const schemas = questionTypeSchemas[type];
  const parsedContent = schemas.content.safeParse(content);
  if (!parsedContent.success) {
    return { ok: false, error: `content: ${formatIssues(parsedContent.error)}` };
  }
  if (schemas.answer === null) {
    return { ok: true, question: { type, content: parsedContent.data, answer: null } as ParsedQuestion };
  }
  const parsedAnswer = schemas.answer.safeParse(answer);
  if (!parsedAnswer.success) {
    return { ok: false, error: `answer: ${formatIssues(parsedAnswer.error)}` };
  }
  const question = { type, content: parsedContent.data, answer: parsedAnswer.data } as ParsedQuestion;
  const crossFieldError = checkCrossFields(question);
  return crossFieldError ? { ok: false, error: crossFieldError } : { ok: true, question };
}

function checkCrossFields(q: ParsedQuestion): string | null {
  switch (q.type) {
    case "MULTIPLE_CHOICE":
    case "LISTEN_AND_CHOOSE":
    case "PICTURE_MATCH": {
      const ids = new Set(q.content.options.map((o) => o.id));
      if (ids.size !== q.content.options.length) return "option ids must be unique";
      if (!q.answer.accepted.every((id) => ids.has(id))) return "answer must reference an option id";
      return null;
    }
    case "MISSING_LETTER":
      return q.answer.accepted.every((a) => q.content.choices.includes(a))
        ? null
        : "answer must be one of the choices";
    case "WORD_BUILDER": {
      // Every accepted spelling must be buildable from the tiles.
      const joined = q.content.tiles.join("").toLowerCase();
      const unbuildable = q.answer.accepted.find((a) => !containsLetters(joined, a));
      return unbuildable ? `tiles cannot build "${unbuildable}"` : null;
    }
    case "SENTENCE_BUILDER": {
      const tokens = [...q.content.tokens].sort().join("\u0000");
      return q.answer.acceptedSequences.every((s) => [...s].sort().join("\u0000") === tokens)
        ? null
        : "each accepted sequence must use exactly the given tokens";
    }
    default:
      return null;
  }
}

function containsLetters(pool: string, word: string) {
  const counts = new Map<string, number>();
  for (const ch of pool) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  for (const ch of word.toLowerCase()) {
    const n = counts.get(ch) ?? 0;
    if (n === 0) return false;
    counts.set(ch, n - 1);
  }
  return true;
}

function formatIssues(error: z.ZodError) {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ");
}
