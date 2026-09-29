import { isSupportedQuestionType, type SupportedQuestionType } from "@/lib/content/question-schemas";

// Question types the client can render today. A type listed in activity_types but not here
// (TRACING, READ_ALOUD, ...) is skipped by the lesson loader until its renderer ships.
export const RENDERABLE_QUESTION_TYPES = [
  "INTRO",
  "MULTIPLE_CHOICE",
  "LISTEN_AND_CHOOSE",
  "PICTURE_MATCH",
  "MISSING_LETTER",
  "WORD_BUILDER",
  "SENTENCE_BUILDER",
  "SPELLING",
] as const satisfies readonly SupportedQuestionType[];

export function isRenderableQuestionType(type: string): type is (typeof RENDERABLE_QUESTION_TYPES)[number] {
  return isSupportedQuestionType(type) && (RENDERABLE_QUESTION_TYPES as readonly string[]).includes(type);
}
