"use client";

import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";
import { PromptHeader } from "./prompt-header";

export function MissingLetterRenderer({
  step,
  phase,
  lastResponse,
  reveal,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"MISSING_LETTER">>) {
  const { content } = step.question;
  const chosen = lastResponse && "value" in lastResponse ? lastResponse.value : null;
  const filled = phase === "reveal" ? (reveal?.value ?? null) : phase === "correct" ? chosen : null;
  const locked = phase !== "answering";

  return (
    <div className="flex flex-col items-center gap-6">
      {content.emoji ? (
        <span className="text-8xl" aria-hidden>
          {content.emoji}
        </span>
      ) : null}
      <PromptHeader step={step} speak={speak} />
      {content.mode === "sound" && content.sound ? (
        <button
          type="button"
          onClick={() => void speak(content.sound!.sayAs, "slow")}
          className="bg-accent-soft text-accent flex min-h-16 items-center gap-2 rounded-2xl px-5 text-2xl font-extrabold shadow-sm"
        >
          <span aria-hidden>🔉</span> /{content.sound.label}/
        </button>
      ) : null}
      <p
        className="flex items-end gap-1 text-7xl font-extrabold"
        aria-label={
          filled ? content.word : `${content.parts.map((p) => ("text" in p ? p.text : "blank")).join(" ")}`
        }
      >
        {content.parts.map((part, i) =>
          "text" in part ? (
            <span key={i} aria-hidden>
              {part.text}
            </span>
          ) : (
            <span
              key={i}
              aria-hidden
              className={cn(
                "inline-flex min-w-20 justify-center rounded-2xl border-4 border-dashed px-2",
                filled ? "border-success bg-success-soft text-success" : "border-primary text-primary/30",
              )}
            >
              {filled ?? "?"}
            </span>
          ),
        )}
      </p>
      <div className="flex flex-wrap justify-center gap-4" role="group" aria-label="Choices">
        {content.choices.map((choice) => {
          const wrong = (phase === "retry" || phase === "reveal") && chosen === choice;
          return (
            <button
              key={choice}
              type="button"
              disabled={locked}
              onClick={() => onAnswer({ value: choice })}
              className={cn(
                "bg-surface min-h-24 min-w-28 rounded-3xl border-4 px-6 text-5xl font-extrabold shadow-sm transition enabled:active:scale-95",
                wrong ? "animate-wiggle border-danger bg-danger-soft" : "border-transparent",
              )}
            >
              {choice}
              {wrong ? <span className="sr-only"> (not right)</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
