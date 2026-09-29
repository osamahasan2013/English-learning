import type { ParsedQuestion } from "@/lib/content/question-schemas";

// The correct answer as the child should see/hear it when it is revealed.
export function answerText(question: ParsedQuestion): string {
  switch (question.type) {
    case "INTRO":
      return "";
    case "MULTIPLE_CHOICE":
    case "LISTEN_AND_CHOOSE":
    case "PICTURE_MATCH": {
      const option = question.content.options.find((o) => o.id === question.answer.accepted[0]);
      return option?.text ?? option?.speech ?? question.answer.accepted[0];
    }
    case "MISSING_LETTER":
      return question.content.word;
    case "WORD_BUILDER":
    case "SPELLING":
      return question.answer.accepted[0];
    case "SENTENCE_BUILDER":
      return question.answer.acceptedSequences[0].join(" ");
  }
}
