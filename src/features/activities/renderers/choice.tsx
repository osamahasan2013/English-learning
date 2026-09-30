"use client";

import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";
import { PromptHeader } from "./prompt-header";

type ChoiceQuestion = QuestionOf<"MULTIPLE_CHOICE" | "LISTEN_AND_CHOOSE" | "PICTURE_MATCH" | "READING">;

// Multiple choice, listen-and-choose and picture match share one renderer; they differ
// only in content (pictures, hidden labels, a spoken prompt).
export function ChoiceRenderer({
  step,
  phase,
  lastResponse,
  reveal,
  onAnswer,
  speak,
}: RendererProps<ChoiceQuestion>) {
  const { content } = step.question;
  const chosen = lastResponse && "value" in lastResponse ? lastResponse.value : null;
  const locked = phase !== "answering";
  const many = content.options.length > 3;

  return (
    <div className="flex flex-col items-center gap-6">
      <PromptHeader step={step} speak={speak} display={content.display} />
      <div
        className={cn("grid w-full gap-4", many ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}
        role="group"
        aria-label="Answers"
      >
        {content.options.map((option) => {
          const isAnswer = reveal?.optionId === option.id;
          const isChosen = chosen === option.id;
          const showRight = (phase === "correct" && isChosen) || (phase === "reveal" && isAnswer);
          const showWrong = (phase === "retry" || phase === "reveal") && isChosen && !isAnswer;
          const status = showRight ? " (right answer)" : showWrong ? " (not right)" : "";
          const label = option.text ?? option.speech ?? option.id;
          return (
            <button
              key={option.id}
              type="button"
              disabled={locked}
              onClick={() => onAnswer({ value: option.id })}
              aria-label={`${label}${status}`}
              aria-pressed={isChosen}
              className={cn(
                "bg-surface relative flex min-h-32 flex-col items-center justify-center gap-2 rounded-3xl border-4 p-4 shadow-sm transition enabled:hover:scale-[1.03] enabled:active:scale-95",
                showRight
                  ? "border-success bg-success-soft"
                  : showWrong
                    ? "animate-wiggle border-danger bg-danger-soft"
                    : "border-transparent",
                locked && !showRight && !showWrong && "opacity-70",
              )}
            >
              {option.emoji ? (
                <span className="text-7xl leading-none" aria-hidden>
                  {option.emoji}
                </span>
              ) : null}
              {!content.hideOptionText && option.text ? (
                <span className={cn("font-bold", option.emoji ? "text-2xl" : "text-4xl")} aria-hidden>
                  {option.text}
                </span>
              ) : null}
              {showRight ? <ResultMark ok /> : showWrong ? <ResultMark ok={false} /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ResultMark({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "absolute top-2 right-2 flex size-9 items-center justify-center rounded-full text-xl font-extrabold text-white",
        ok ? "bg-success" : "bg-danger",
      )}
      aria-hidden
    >
      {ok ? "✓" : "✗"}
    </span>
  );
}
