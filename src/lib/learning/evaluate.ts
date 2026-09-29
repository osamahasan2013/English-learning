import type { AnswerSpec, QuestionResponse } from "@/lib/content/question-schemas";

// Answer checking, shared by the lesson player (instant feedback, works offline) and the
// sync endpoint (authoritative: the server re-evaluates every synced answer against the
// stored question and ignores any correctness claim from the device).

export type EvaluationResult = {
  isCorrect: boolean;
  // Coarse, parent-meaningful error category; null when correct.
  errorType: ErrorType | null;
};

export type ErrorType =
  | "wrong_choice"
  | "wrong_pattern"
  | "wrong_order"
  | "wrong_letters"
  | "missing_letters"
  | "extra_letters"
  | "misspelling"
  | "invalid_response";

export function normalizeText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

// Sentence tokens are compared without case or surrounding punctuation: the child orders
// given tokens, so capitalisation and the full stop are not what is being tested.
function normalizeToken(value: string) {
  return normalizeText(value).replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
}

export function evaluateResponse(
  questionType: string,
  answer: AnswerSpec | null,
  response: QuestionResponse,
): EvaluationResult {
  if (answer === null) return { isCorrect: true, errorType: null };

  if ("acceptedSequences" in answer) {
    if (!("sequence" in response)) return { isCorrect: false, errorType: "invalid_response" };
    const given = response.sequence.map(normalizeToken);
    const match = answer.acceptedSequences.some(
      (seq) => seq.length === given.length && seq.every((token, i) => normalizeToken(token) === given[i]),
    );
    return match ? { isCorrect: true, errorType: null } : { isCorrect: false, errorType: "wrong_order" };
  }

  const accepted = answer.accepted.map(normalizeText);
  const value =
    "value" in response ? normalizeText(response.value) : normalizeText(response.sequence.join(""));
  if (accepted.includes(value)) return { isCorrect: true, errorType: null };

  switch (questionType) {
    case "MULTIPLE_CHOICE":
    case "LISTEN_AND_CHOOSE":
    case "PICTURE_MATCH":
      return { isCorrect: false, errorType: "wrong_choice" };
    case "MISSING_LETTER":
      return { isCorrect: false, errorType: "wrong_pattern" };
    case "WORD_BUILDER":
    case "SPELLING":
      return { isCorrect: false, errorType: classifySpellingError(accepted[0], value) };
    default:
      return { isCorrect: false, errorType: "wrong_choice" };
  }
}

// Classifies a wrong spelling so parents see *how* it was wrong, not just that it was.
export function classifySpellingError(target: string, given: string): ErrorType {
  if (given.length === 0) return "missing_letters";
  const sorted = (s: string) => [...s].sort().join("");
  if (sorted(target) === sorted(given)) return "wrong_order";
  if (given.length < target.length && isSubsequence(given, target)) return "missing_letters";
  if (given.length > target.length && isSubsequence(target, given)) return "extra_letters";
  if (given.length === target.length) return "wrong_letters";
  return "misspelling";
}

function isSubsequence(small: string, big: string) {
  let i = 0;
  for (const ch of big) if (ch === small[i]) i++;
  return i === small.length;
}
