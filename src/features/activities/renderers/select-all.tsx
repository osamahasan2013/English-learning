"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";
import { ResultMark } from "./choice";
import { PromptHeader } from "./prompt-header";
import { StoryPanel } from "./reading";

// Choose every right answer: tap options on and off, then Check. Chosen options show a tick
// box as well as a colour, and right/wrong marks after checking.
export function SelectAllRenderer({
  step,
  phase,
  lastResponse,
  reveal,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"SELECT_ALL">>) {
  const { content } = step.question;
  const previous = lastResponse && "sequence" in lastResponse ? lastResponse.sequence : [];
  const [chosen, setChosen] = useState<string[]>(phase === "answering" ? [] : previous);
  const locked = phase !== "answering";
  const answered = phase === "correct" || phase === "reveal";
  const rightIds = phase === "correct" ? previous : (reveal?.sequence ?? null);

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <div className="flex flex-col items-center gap-6">
      <StoryPanel step={step} speak={speak} pointTo={answered ? (content.ref ?? null) : null} />
      <PromptHeader step={step} speak={speak} display={content.display} />
      <p className="text-muted text-xl font-semibold">Choose all the right ones.</p>
      <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3" role="group" aria-label="Answers">
        {content.options.map((option) => {
          const isChosen = chosen.includes(option.id);
          const isRight = rightIds?.includes(option.id) ?? false;
          const showRight = answered && isRight;
          const showWrong = (phase === "retry" || phase === "reveal") && isChosen && !isRight;
          const label = option.text ?? option.speech ?? option.id;
          const status = showRight ? " (right answer)" : showWrong ? " (not right)" : "";
          return (
            <button
              key={option.id}
              type="button"
              disabled={locked}
              onClick={() => toggle(option.id)}
              aria-pressed={isChosen}
              aria-label={`${label}${status}`}
              className={cn(
                "bg-surface relative flex min-h-28 flex-col items-center justify-center gap-2 rounded-3xl border-4 p-4 shadow-sm transition enabled:active:scale-95",
                showRight
                  ? "border-success bg-success-soft"
                  : showWrong
                    ? "border-danger bg-danger-soft"
                    : isChosen
                      ? "border-primary"
                      : "border-transparent",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute top-2 left-2 flex size-8 items-center justify-center rounded-lg border-2 text-lg font-extrabold",
                  isChosen ? "border-primary bg-primary text-white" : "border-border",
                )}
              >
                {isChosen ? "✓" : ""}
              </span>
              {option.emoji ? (
                <span className="text-6xl leading-none" aria-hidden>
                  {option.emoji}
                </span>
              ) : null}
              {option.text ? (
                <span className={cn("font-bold", option.emoji ? "text-2xl" : "text-3xl")} aria-hidden>
                  {option.text}
                </span>
              ) : null}
              {showRight ? <ResultMark ok /> : showWrong ? <ResultMark ok={false} /> : null}
            </button>
          );
        })}
      </div>
      {!locked ? (
        <Button size="xl" disabled={chosen.length === 0} onClick={() => onAnswer({ sequence: chosen })}>
          Check
        </Button>
      ) : null}
    </div>
  );
}
