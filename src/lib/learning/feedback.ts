import { letterToken } from "@/lib/audio/pronunciation";

// Feedback after each answer and at the end of a lesson. The kinds are fixed by the
// engine; the words come from the feedback_messages table (content), rotated so the
// child does not hear the same phrase every time. The fallbacks below are used only if
// no published message exists for a kind.

export const FEEDBACK_KINDS = ["CORRECT", "INCORRECT", "TRY_AGAIN", "ALMOST_CORRECT", "COMPLETED"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export type FeedbackMessage = {
  kind: FeedbackKind;
  text: string;
  // What is said aloud (defaults to `text`). `{answer}` is replaced by the answer.
  speech: string;
  emoji: string;
  // Set for words about one spelling error category ("Two letters make that sound!").
  errorCategory?: string | null;
};

export const FALLBACK_FEEDBACK: Record<FeedbackKind, FeedbackMessage> = {
  CORRECT: { kind: "CORRECT", text: "Great job!", speech: "", emoji: "✓" },
  TRY_AGAIN: { kind: "TRY_AGAIN", text: "Try again.", speech: "", emoji: "↻" },
  ALMOST_CORRECT: { kind: "ALMOST_CORRECT", text: "So close! Try again.", speech: "", emoji: "🤏" },
  INCORRECT: { kind: "INCORRECT", text: "The answer is {answer}.", speech: "", emoji: "💡" },
  COMPLETED: { kind: "COMPLETED", text: "You finished!", speech: "", emoji: "🎉" },
};

export function feedbackKind(args: {
  isCorrect: boolean;
  almost: boolean;
  attemptNumber: number;
  maxTries: number;
}): Exclude<FeedbackKind, "COMPLETED"> {
  if (args.isCorrect) return "CORRECT";
  if (args.attemptNumber < args.maxTries) return args.almost ? "ALMOST_CORRECT" : "TRY_AGAIN";
  return "INCORRECT";
}

const NO_ANSWER_FALLBACK: FeedbackMessage = {
  kind: "INCORRECT",
  text: "Good try! Let's keep going.",
  speech: "",
  emoji: "💡",
};

// Deterministic rotation: the same seed always picks the same message. Without an answer
// to show, messages that would say "{answer}" are skipped.
export function pickFeedback(
  messages: FeedbackMessage[],
  kind: FeedbackKind,
  seed: number,
  options: { hasAnswer?: boolean } = {},
): FeedbackMessage {
  const hasAnswer = options.hasAnswer ?? true;
  const usable = (m: FeedbackMessage) => hasAnswer || !`${m.text} ${m.speech}`.includes("{answer}");
  const pool = messages.filter((m) => m.kind === kind && !m.errorCategory && usable(m));
  if (pool.length > 0) return pool[Math.abs(Math.trunc(seed)) % pool.length];
  return usable(FALLBACK_FEEDBACK[kind]) ? FALLBACK_FEEDBACK[kind] : NO_ANSWER_FALLBACK;
}

export function renderFeedback(message: FeedbackMessage, vars: { answer?: string; pattern?: string } = {}) {
  const fill = (s: string, pattern: string) =>
    s
      .replace(/\{answer\}/g, vars.answer ?? "")
      .replace(/\{pattern\}/g, pattern)
      .replace(/\s+([.!?])/g, "$1")
      .trim();
  // Shown as capitals (SH); said as the letters' NAMES ({@s} {@h} → "ess aitch"), since
  // the message is about which letters to write — a voice would misread "SH" anyway.
  const letters = [...(vars.pattern ?? "").toLowerCase()].filter((c) => /[a-z]/.test(c));
  const text = fill(message.text, (vars.pattern ?? "").toUpperCase());
  const spoken = letters.map(letterToken).join(" ");
  return { text, speech: fill(message.speech || message.text, spoken), emoji: message.emoji };
}

// The words for one spelling error category (feedback_messages.error_category), rotated
// like the others; null when there are none, so the general message stands alone.
// A message may name the letters of the pattern the mistake was in ("Remember: {pattern}
// makes one sound."); without a pattern such messages are skipped.
export function pickErrorFeedback(
  messages: FeedbackMessage[],
  category: string | null | undefined,
  seed: number,
  options: { pattern?: string | null } = {},
): FeedbackMessage | null {
  if (!category) return null;
  const pool = messages.filter(
    (m) =>
      m.errorCategory === category && (!!options.pattern || !`${m.text} ${m.speech}`.includes("{pattern}")),
  );
  return pool.length > 0 ? pool[Math.abs(Math.trunc(seed)) % pool.length] : null;
}
