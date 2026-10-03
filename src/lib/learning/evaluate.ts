import type { AnswerSpec, QuestionResponse } from "@/lib/content/question-schemas";
import {
  analyzeSentence,
  analyzeSpelling,
  canonicalSentence,
  punctuationCheck,
  type SpellingErrorType,
} from "@/lib/learning/spelling";

// Answer checking. The server evaluates every synced answer against the stored question
// (authoritative; the device's verdict is never sent). The device gives instant feedback
// from a digest-only answer key built from the SAME canonical forms (answer-key.ts), so
// both always agree without the payload carrying plaintext answers.

export type EvaluationResult = {
  isCorrect: boolean;
  // A near miss worth a gentler "almost" (right letters in the wrong order, most pairs
  // right, most blanks filled right). Never counts as correct.
  almost: boolean;
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
  | "wrong_match"
  | "wrong_group"
  | "wrong_word"
  | "incomplete_trace"
  | "wrong_sounds"
  | "wrong_count"
  | "invalid_response"
  // Spelling answers are classified by the spelling engine (spelling.ts).
  | SpellingErrorType;

export function normalizeText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

// Sentence tokens are compared without case or surrounding punctuation: the child orders
// given tokens, so capitalisation and the full stop are not what is being tested.
export function normalizeToken(value: string) {
  return normalizeText(value).replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
}

// Written answers: case, spacing and end punctuation are not what is being tested.
function normalizeWriting(value: string) {
  return normalizeText(value)
    .replace(/[.!?,;:]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const SEQUENCE_TYPES = new Set(["SENTENCE_BUILDER", "DRAG_DROP", "SEGMENT_WORD"]);
export const PAIR_TYPES = new Set(["MATCH", "SORT"]);
// Types whose near misses are "right letters, wrong order".
const LETTER_TYPES = new Set(["WORD_BUILDER", "SPELLING"]);
// A near miss needs at least this share of parts right (pairs, blanks, tokens).
export const ALMOST_SHARE = 0.5;
// Tracing within this many coverage points of the target counts as "almost".
export const TRACE_ALMOST_MARGIN = 15;

// ---- Canonical forms (shared with answer-key.ts) --------------------------------------

function canonicalText(questionType: string, value: string) {
  if (questionType === "WRITING") return normalizeWriting(value);
  // Sentence dictation compares the words; capitals and the end mark are checked apart.
  if (questionType === "SENTENCE_DICTATION") return canonicalSentence(value);
  return normalizeText(value);
}

export function canonicalAccepted(questionType: string, accepted: string[]) {
  return accepted.map((a) => canonicalText(questionType, a));
}

export function canonicalValue(questionType: string, response: QuestionResponse): string | null {
  if ("value" in response) return canonicalText(questionType, response.value);
  if ("sequence" in response) return normalizeText(response.sequence.join(""));
  return null;
}

export function canonicalSequence(sequence: string[]) {
  return sequence.map(normalizeToken).join(" ");
}

export function canonicalPair(pair: readonly [string, string]) {
  return `${normalizeText(pair[0])}=${normalizeText(pair[1])}`;
}

export function canonicalPosition(index: number, token: string) {
  return `${index}:${normalizeToken(token)}`;
}

export function sortedLetters(value: string) {
  return [...value.replace(/[^\p{L}]/gu, "")].sort().join("");
}

export function isAlmostShare(right: number, total: number) {
  return total >= 2 && right < total && right >= Math.ceil(total * ALMOST_SHARE);
}

// ---- Evaluation -------------------------------------------------------------------------

const correct: EvaluationResult = { isCorrect: true, almost: false, errorType: null };
const invalid: EvaluationResult = { isCorrect: false, almost: false, errorType: "invalid_response" };

export function evaluateResponse(
  questionType: string,
  answer: AnswerSpec | null,
  response: QuestionResponse,
): EvaluationResult {
  if (answer === null) return correct;

  if ("minCoverage" in answer) {
    if (!("coverage" in response)) return invalid;
    if (response.coverage >= answer.minCoverage) return correct;
    return {
      isCorrect: false,
      almost: response.coverage >= answer.minCoverage - TRACE_ALMOST_MARGIN,
      errorType: "incomplete_trace",
    };
  }

  if ("pairs" in answer) {
    if (!("pairs" in response)) return invalid;
    const expected = new Set(answer.pairs.map(canonicalPair));
    const given = new Set(response.pairs.map(canonicalPair));
    const right = [...given].filter((p) => expected.has(p)).length;
    if (right === expected.size && response.pairs.length === expected.size) return correct;
    return {
      isCorrect: false,
      almost: isAlmostShare(right, expected.size),
      errorType: questionType === "SORT" ? "wrong_group" : "wrong_match",
    };
  }

  if ("acceptedSequences" in answer) {
    if (!("sequence" in response)) return invalid;
    const given = canonicalSequence(response.sequence);
    if (answer.acceptedSequences.some((seq) => canonicalSequence(seq) === given)) return correct;
    const target = answer.acceptedSequences[0];
    const right = response.sequence.filter(
      (token, i) => i < target.length && canonicalPosition(i, token) === canonicalPosition(i, target[i]),
    ).length;
    return {
      isCorrect: false,
      almost: isAlmostShare(right, target.length),
      errorType:
        questionType === "DRAG_DROP"
          ? "wrong_word"
          : questionType === "SEGMENT_WORD"
            ? response.sequence.length === target.length
              ? "wrong_sounds"
              : "wrong_count"
            : "wrong_order",
    };
  }

  const value = canonicalValue(questionType, response);
  if (value === null) return invalid;
  const accepted = canonicalAccepted(questionType, answer.accepted);

  if (questionType === "SENTENCE_DICTATION" && "value" in response) {
    const requirePunctuation = "requirePunctuation" in answer && answer.requirePunctuation === true;
    if (accepted.includes(value)) {
      const marks = punctuationCheck(response.value);
      if (!requirePunctuation || (marks.capital && marks.end)) return correct;
      return { isCorrect: false, almost: true, errorType: "PUNCTUATION" };
    }
    const analysis = analyzeSentence({
      expected: answer.accepted[0],
      actual: response.value,
      requirePunctuation,
    });
    return { isCorrect: false, almost: analysis.almost, errorType: analysis.category ?? "UNKNOWN" };
  }
  if (accepted.includes(value)) return correct;

  const almost =
    LETTER_TYPES.has(questionType) && accepted.some((a) => sortedLetters(a) === sortedLetters(value));
  switch (questionType) {
    case "MULTIPLE_CHOICE":
    case "LISTEN_AND_CHOOSE":
    case "PICTURE_MATCH":
    case "READING":
    case "BLEND_SOUNDS":
      return { isCorrect: false, almost: false, errorType: "wrong_choice" };
    case "FIND_PATTERN":
      return { isCorrect: false, almost: false, errorType: "wrong_letters" };
    case "MISSING_LETTER":
      return { isCorrect: false, almost: false, errorType: "wrong_pattern" };
    case "WORD_BUILDER":
    case "SPELLING": {
      // The progress writer refines this with the word's grapheme split (spelling.ts).
      const analysis = analyzeSpelling({ expected: answer.accepted, actual: value });
      return { isCorrect: false, almost, errorType: analysis.category ?? "UNKNOWN" };
    }
    case "WRITING":
      return { isCorrect: false, almost, errorType: classifySpellingError(accepted[0], value) };
    default:
      return { isCorrect: false, almost: false, errorType: "wrong_choice" };
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
