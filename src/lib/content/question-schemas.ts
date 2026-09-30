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
  // Letters only: the letter's NAME and its SOUND, shown and played as two different
  // things ("bee" is the name; /b/ "buh" is the sound).
  letter: z
    .object({
      upper: z.string().trim().min(1).max(2),
      lower: z.string().trim().min(1).max(2),
      name: text(20),
      nameSpeech: text(40),
      soundLabel: text(8),
      soundSpeech: text(40),
    })
    .optional(),
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

const itemId = z.string().regex(/^[a-z0-9-]{1,40}$/);

// Match pairs (left ↔ right): a picture to its word, a capital to its small letter.
export const matchItemSchema = z.object({
  id: itemId,
  text: z.string().trim().max(40).optional(),
  emoji: z.string().max(16).optional(),
  speech: z.string().trim().max(120).optional(),
});
export const matchContentSchema = z.object({
  left: z.array(matchItemSchema).min(2).max(6),
  right: z.array(matchItemSchema).min(2).max(6),
});

// Sort items into 2–4 groups ("sh" words / "ch" words).
export const sortContentSchema = z.object({
  groups: z
    .array(z.object({ id: itemId, label: text(40), emoji: z.string().max(16).optional() }))
    .min(2)
    .max(4),
  items: z.array(matchItemSchema).min(2).max(10),
});

// Drag words from a bank into the blanks of a sentence or word ("The ___ sat.").
export const dragDropContentSchema = z
  .object({
    emoji: z.string().max(16).optional(),
    parts: z
      .array(z.union([z.object({ text: text(60) }), z.object({ blank: z.literal(true) })]))
      .min(2)
      .max(12),
    bank: z.array(text(24)).min(2).max(8),
  })
  .refine((c) => c.parts.some((p) => "blank" in p), { message: "drag-drop content needs a blank" });

// Reading comprehension: the passage lives in the activity config (shared by its
// questions); each question is a choice about it.
export const readingContentSchema = choiceContentSchema;

// Write a word or finish a sentence, with a word bank to copy from.
export const writingContentSchema = z.object({
  emoji: z.string().max(16).optional(),
  starter: z.string().trim().max(80).optional(),
  wordBank: z.array(text(24)).min(2).max(8),
  hint: z.string().trim().max(120).optional(),
});

// Trace a letter with a finger; scored by how much of the letter the strokes cover.
export const tracingContentSchema = z.object({
  letter: z.string().trim().min(1).max(2),
  speech: z.string().trim().max(60).optional(),
});

// A sound unit a child can tap to hear (a grapheme segment, or a phoneme).
const soundUnitSchema = z.object({
  grapheme: text(6),
  sayAs: z.string().trim().max(40),
});

// Blending: tap each sound, blend them (slow or normal), then choose the word they make.
// The word itself is only spoken after answering.
export const blendSoundsContentSchema = z.object({
  emoji: z.string().max(16).optional(),
  units: z.array(soundUnitSchema).min(1).max(8),
  options: z.array(choiceOptionSchema).min(2).max(4),
});

// Segmenting: hear a word, say how many sounds it has, then pick those sounds in order.
// Sound cards are phonemes (shown as /sh/), never the word's letters.
export const segmentWordContentSchema = z.object({
  word: text(40),
  emoji: z.string().max(16).optional(),
  speech: text(60),
  sounds: z
    .array(z.object({ id: itemId, label: text(8), sayAs: text(40) }))
    .min(2)
    .max(10),
  maxCount: z.number().int().min(2).max(8),
});

// Find the pattern (e.g. the digraph) in a written word by tapping its letters.
export const findPatternContentSchema = z.object({
  word: z.string().trim().regex(/^[a-z']{2,20}$/),
  emoji: z.string().max(16).optional(),
  speech: z.string().trim().max(60).optional(),
  // What to look for, as shown to the child ("sh").
  target: text(8),
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

export const pairsAnswerSchema = z.object({
  pairs: z.array(z.tuple([itemId, itemId])).min(1).max(10),
});

export const coverageAnswerSchema = z.object({
  minCoverage: z.number().int().min(30).max(95),
});

export const valueResponseSchema = z.object({ value: z.string().max(200) });
export const sequenceResponseSchema = z.object({ sequence: z.array(z.string().max(40)).max(20) });
export const pairsResponseSchema = z.object({
  pairs: z.array(z.tuple([z.string().max(40), z.string().max(40)])).max(10),
});
export const coverageResponseSchema = z.object({ coverage: z.number().min(0).max(100) });
export const responseSchema = z.union([
  valueResponseSchema,
  sequenceResponseSchema,
  pairsResponseSchema,
  coverageResponseSchema,
]);
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
  MATCH: { content: matchContentSchema, answer: pairsAnswerSchema, response: pairsResponseSchema },
  SORT: { content: sortContentSchema, answer: pairsAnswerSchema, response: pairsResponseSchema },
  DRAG_DROP: {
    content: dragDropContentSchema,
    answer: sequenceAnswerSchema,
    response: sequenceResponseSchema,
  },
  READING: { content: readingContentSchema, answer: acceptedAnswerSchema, response: valueResponseSchema },
  WRITING: { content: writingContentSchema, answer: acceptedAnswerSchema, response: valueResponseSchema },
  TRACING: { content: tracingContentSchema, answer: coverageAnswerSchema, response: coverageResponseSchema },
  BLEND_SOUNDS: {
    content: blendSoundsContentSchema,
    answer: acceptedAnswerSchema,
    response: valueResponseSchema,
  },
  SEGMENT_WORD: {
    content: segmentWordContentSchema,
    answer: sequenceAnswerSchema,
    response: sequenceResponseSchema,
  },
  // The answer is the letters' span in the word: "start-end" (0-based, inclusive).
  FIND_PATTERN: {
    content: findPatternContentSchema,
    answer: acceptedAnswerSchema,
    response: valueResponseSchema,
  },
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
export type MatchContent = z.infer<typeof matchContentSchema>;
export type SortContent = z.infer<typeof sortContentSchema>;
export type DragDropContent = z.infer<typeof dragDropContentSchema>;
export type ReadingContent = z.infer<typeof readingContentSchema>;
export type WritingContent = z.infer<typeof writingContentSchema>;
export type TracingContent = z.infer<typeof tracingContentSchema>;
export type BlendSoundsContent = z.infer<typeof blendSoundsContentSchema>;
export type SegmentWordContent = z.infer<typeof segmentWordContentSchema>;
export type FindPatternContent = z.infer<typeof findPatternContentSchema>;
export type AcceptedAnswer = z.infer<typeof acceptedAnswerSchema>;
export type SequenceAnswer = z.infer<typeof sequenceAnswerSchema>;
export type PairsAnswer = z.infer<typeof pairsAnswerSchema>;
export type CoverageAnswer = z.infer<typeof coverageAnswerSchema>;
export type AnswerSpec = AcceptedAnswer | SequenceAnswer | PairsAnswer | CoverageAnswer;

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
  | { type: "SPELLING"; content: SpellingContent; answer: AcceptedAnswer }
  | { type: "MATCH"; content: MatchContent; answer: PairsAnswer }
  | { type: "SORT"; content: SortContent; answer: PairsAnswer }
  | { type: "DRAG_DROP"; content: DragDropContent; answer: SequenceAnswer }
  | { type: "READING"; content: ReadingContent; answer: AcceptedAnswer }
  | { type: "WRITING"; content: WritingContent; answer: AcceptedAnswer }
  | { type: "TRACING"; content: TracingContent; answer: CoverageAnswer }
  | { type: "BLEND_SOUNDS"; content: BlendSoundsContent; answer: AcceptedAnswer }
  | { type: "SEGMENT_WORD"; content: SegmentWordContent; answer: SequenceAnswer }
  | { type: "FIND_PATTERN"; content: FindPatternContent; answer: AcceptedAnswer };

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
    case "PICTURE_MATCH":
    case "READING":
    case "BLEND_SOUNDS": {
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
    case "MATCH": {
      const left = new Set(q.content.left.map((i) => i.id));
      const right = new Set(q.content.right.map((i) => i.id));
      if (left.size !== q.content.left.length || right.size !== q.content.right.length)
        return "item ids must be unique";
      if (q.answer.pairs.length !== left.size) return "every left item needs exactly one pair";
      if (new Set(q.answer.pairs.map((p) => p[0])).size !== left.size) return "a left item is paired twice";
      return q.answer.pairs.every(([l, r]) => left.has(l) && right.has(r))
        ? null
        : "pairs must reference item ids";
    }
    case "SORT": {
      const items = new Set(q.content.items.map((i) => i.id));
      const groups = new Set(q.content.groups.map((g) => g.id));
      if (items.size !== q.content.items.length || groups.size !== q.content.groups.length)
        return "item and group ids must be unique";
      if (q.answer.pairs.length !== items.size || new Set(q.answer.pairs.map((p) => p[0])).size !== items.size)
        return "every item must be sorted into exactly one group";
      return q.answer.pairs.every(([item, group]) => items.has(item) && groups.has(group))
        ? null
        : "pairs must reference item and group ids";
    }
    case "DRAG_DROP": {
      const blanks = q.content.parts.filter((p) => "blank" in p).length;
      const bank = q.content.bank.map((b) => b.toLowerCase());
      for (const seq of q.answer.acceptedSequences) {
        if (seq.length !== blanks) return "each accepted sequence needs one word per blank";
        if (!seq.every((w) => bank.includes(w.toLowerCase()))) return "answers must come from the word bank";
      }
      return null;
    }
    case "SEGMENT_WORD": {
      const ids = new Set(q.content.sounds.map((x) => x.id));
      if (ids.size !== q.content.sounds.length) return "sound ids must be unique";
      for (const seq of q.answer.acceptedSequences) {
        if (seq.length > q.content.maxCount) return "the answer has more sounds than maxCount";
        if (!seq.every((id) => ids.has(id))) return "answers must use the listed sounds";
      }
      return null;
    }
    case "FIND_PATTERN": {
      for (const span of q.answer.accepted) {
        const m = span.match(/^(\d+)-(\d+)$/);
        if (!m) return `"${span}" is not a start-end span`;
        const [start, end] = [Number(m[1]), Number(m[2])];
        if (start > end || end >= q.content.word.length) return `span ${span} is outside "${q.content.word}"`;
        if (q.content.word.slice(start, end + 1) !== q.content.target.toLowerCase())
          return `span ${span} of "${q.content.word}" is not "${q.content.target}"`;
      }
      return null;
    }
    case "WRITING": {
      // The child copies from the word bank, so every answer must be writable from it.
      const bank = new Set(q.content.wordBank.map((w) => w.toLowerCase()));
      const starter = (q.content.starter ?? "").toLowerCase().trim();
      const ok = q.answer.accepted.every((a) => {
        const rest = a.toLowerCase().replace(/[.!?]+$/, "").trim();
        const tail = starter && rest.startsWith(starter) ? rest.slice(starter.length).trim() : rest;
        return tail.split(/\s+/).every((w) => bank.has(w));
      });
      return ok ? null : "writing answers must use words from the word bank";
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
