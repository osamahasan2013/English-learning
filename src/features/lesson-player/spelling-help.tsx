"use client";

import { pickErrorFeedback, renderFeedback, type FeedbackMessage } from "@/lib/learning/feedback";
import type { LessonStep } from "@/lib/learning/lesson-payload";
import type { QuestionResponse, SpellingHintContent } from "@/lib/content/question-schemas";
import {
  analyzeAnswer,
  diffCells,
  fallbackSplit,
  type AnswerAnalysis,
  type DiffCell,
} from "@/lib/learning/spelling";
import type { AudioSpeed } from "@/lib/audio/audio-service";
import { cn } from "@/lib/utils";

// The spelling parts of the lesson player: progressive hints before answering, and after a
// wrong answer the "understand the mistake" panel — what kind of mistake it was (in words
// from feedback_messages), and the child's letters marked right / wrong / extra / missing.
// Before the answer is revealed nothing shows the right letters.

export function stepHints(step: LessonStep): SpellingHintContent[] {
  const hints = (step.question.content as { hints?: SpellingHintContent[] }).hints ?? [];
  const settings = step.spelling;
  if (!settings || settings.maxHints <= 0) return [];
  // With a replay limit, "listen again slowly" would get round it.
  const usable =
    settings.replayLimit !== null
      ? hints.filter((h) => h.kind !== "listen" && h.kind !== "listen_slow")
      : hints;
  return usable.slice(0, settings.maxHints);
}

export function HintBox({
  step,
  shown,
  onShow,
  speak,
}: {
  step: LessonStep;
  shown: number;
  onShow: (count: number) => void;
  speak: (text: string, speed?: AudioSpeed) => Promise<unknown>;
}) {
  const hints = stepHints(step);
  if (hints.length === 0) return null;
  const word = (step.question.content as { speech?: string }).speech ?? "";
  const open = hints.slice(0, shown);
  const next = hints[shown];
  const play = (hint: SpellingHintContent) =>
    void (hint.kind === "listen"
      ? speak(hint.speech || word)
      : hint.kind === "listen_slow"
        ? speak(hint.speech || word, "slow")
        : speak(hint.speech || hint.text));
  return (
    <div className="flex flex-col items-center gap-3" data-testid="hints">
      {open.length > 0 ? (
        <ul className="flex w-full max-w-xl flex-col gap-2" aria-label="Hints">
          {open.map((hint, i) => (
            <li key={i} className="bg-sun/30 flex items-center gap-3 rounded-2xl px-4 py-3">
              <span className="text-3xl" aria-hidden>
                💡
              </span>
              <span className="flex-1">
                <span className="block text-xl font-bold">{hint.text}</span>
                {hint.show ? (
                  <span className="block text-3xl font-extrabold tracking-widest" aria-hidden>
                    {hint.show}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => play(hint)}
                aria-label="Hear the hint"
                className="bg-surface flex size-12 shrink-0 items-center justify-center rounded-full text-2xl shadow-sm"
              >
                <span aria-hidden>🔊</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {next ? (
        <button
          type="button"
          onClick={() => {
            onShow(shown + 1);
            play(next);
          }}
          className="border-sun bg-surface flex min-h-14 items-center gap-2 rounded-2xl border-4 px-5 text-xl font-bold shadow-sm"
        >
          <span aria-hidden>💡</span> {shown === 0 ? "Hint" : "Another hint"}
          <span className="text-muted text-base">
            ({shown + 1}/{hints.length})
          </span>
        </button>
      ) : null}
    </div>
  );
}

// The device's explanation of a wrong spelling, from the spoken word the question carries
// (the server stores its own analysis from the real answer).
export function analyzeStepAnswer(
  step: LessonStep,
  response: QuestionResponse | null,
): AnswerAnalysis | null {
  if (!response || !step.spelling) return null;
  return analyzeAnswer(step.question, response as { value?: string; sequence?: string[] });
}

export function spellingErrorMessage(
  analysis: AnswerAnalysis | null,
  messages: FeedbackMessage[],
  seed: number,
) {
  if (!analysis || analysis.correct) return null;
  // The pattern's letters, for "Remember: SH makes one sound." (multi-letter patterns only).
  const grapheme = analysis.kind === "word" && analysis.patternCode ? analysis.focus?.grapheme : undefined;
  const pattern = grapheme && grapheme.length > 1 ? grapheme : null;
  const message = pickErrorFeedback(messages, analysis.category, seed, { pattern });
  return message ? renderFeedback(message, { pattern: pattern ?? undefined }) : null;
}

const MARK: Record<DiffCell["mark"], { label: string; className: string }> = {
  ok: { label: "right", className: "border-success text-success" },
  wrong: {
    label: "not right",
    className: "border-danger bg-danger-soft text-danger underline decoration-wavy",
  },
  extra: { label: "extra", className: "border-danger text-danger line-through" },
  missing: { label: "missing letter", className: "border-dashed border-warning text-warning" },
};
const SYMBOL: Record<DiffCell["mark"], string> = { ok: "✓", wrong: "✗", extra: "+", missing: "?" };

export function SpellingMistake({
  step,
  analysis,
  message,
  revealed,
}: {
  step: LessonStep;
  analysis: AnswerAnalysis;
  message: { text: string; emoji: string } | null;
  revealed: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-3"
      data-testid="spelling-mistake"
      data-category={analysis.category ?? ""}
    >
      {message ? (
        <p className="text-xl font-bold">
          <span aria-hidden>{message.emoji || "👂"} </span>
          {message.text}
        </p>
      ) : null}
      {analysis.kind === "word" ? (
        <WordDiff step={step} analysis={analysis} revealed={revealed} />
      ) : (
        <SentenceDiff analysis={analysis} revealed={revealed} />
      )}
    </div>
  );
}

function WordDiff({
  step,
  analysis,
  revealed,
}: {
  step: LessonStep;
  analysis: Extract<AnswerAnalysis, { kind: "word" }>;
  revealed: boolean;
}) {
  const cells = diffCells(analysis.ops);
  const content = step.question.content as {
    speech?: string;
    word?: string;
    split?: { grapheme: string }[];
  };
  const word = (content.word ?? content.speech ?? "").toLowerCase();
  const split = content.split?.length ? content.split : fallbackSplit(word);
  const focus = analysis.focus?.position ?? -1;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">You wrote:</span>
        <span
          className="flex flex-wrap gap-1"
          role="img"
          aria-label={cells
            .map((c) => (c.mark === "missing" ? "a missing letter" : `${c.text} ${MARK[c.mark].label}`))
            .join(", ")}
        >
          {cells.map((c, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                "bg-surface flex min-w-10 flex-col items-center rounded-xl border-2 px-2 text-3xl font-extrabold",
                MARK[c.mark].className,
              )}
            >
              {c.text}
              <span className="text-sm leading-none">{SYMBOL[c.mark]}</span>
            </span>
          ))}
        </span>
      </div>
      {revealed && word ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-semibold">The word:</span>
          <span className="flex flex-wrap gap-1" aria-label={word}>
            {split.map((g, i) => (
              <span
                key={i}
                aria-hidden
                className={cn(
                  "rounded-xl px-2 text-3xl font-extrabold",
                  i === focus ? "bg-sun/50 underline decoration-4 underline-offset-4" : "bg-surface",
                )}
              >
                {g.grapheme}
              </span>
            ))}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function SentenceDiff({
  analysis,
  revealed,
}: {
  analysis: Extract<AnswerAnalysis, { kind: "sentence" }>;
  revealed: boolean;
}) {
  const label = (w: (typeof analysis.words)[number]) => {
    switch (w.status) {
      case "ok":
        return { text: w.actual!, symbol: "✓", className: MARK.ok.className, sr: `${w.actual} right` };
      case "misspelled":
        return {
          text: revealed ? `${w.actual} → ${w.expected}` : w.actual!,
          symbol: "✗",
          className: MARK.wrong.className,
          sr: `${w.actual} is not spelled right`,
        };
      case "missing":
        return {
          text: revealed ? w.expected! : "___",
          symbol: "?",
          className: MARK.missing.className,
          sr: "a missing word",
        };
      case "extra":
        return { text: w.actual!, symbol: "+", className: MARK.extra.className, sr: `${w.actual} is extra` };
      case "moved":
        return {
          text: w.actual ?? (revealed ? w.expected! : "___"),
          symbol: "↔",
          className: MARK.missing.className,
          sr: "a word in the wrong place",
        };
    }
  };
  const items = analysis.words.map(label);
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap gap-1" role="img" aria-label={items.map((i) => i.sr).join(", ")}>
        {items.map((item, i) => (
          <span
            key={i}
            aria-hidden
            className={cn(
              "bg-surface flex flex-col items-center rounded-xl border-2 px-2 text-2xl font-bold",
              item.className,
            )}
          >
            {item.text}
            <span className="text-sm leading-none">{item.symbol}</span>
          </span>
        ))}
      </p>
      {analysis.punctuation.required && (!analysis.punctuation.capital || !analysis.punctuation.end) ? (
        <p className="text-lg font-semibold">
          <span aria-hidden>✒️ </span>
          {!analysis.punctuation.capital ? "Start with a capital letter. " : ""}
          {!analysis.punctuation.end ? "End with a full stop." : ""}
        </p>
      ) : null}
    </div>
  );
}
