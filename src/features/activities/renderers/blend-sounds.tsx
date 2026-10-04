"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";
import { ResultMark } from "./choice";
import { PromptHeader } from "./prompt-header";

// Blending: tap each sound to hear it, blend them slowly or at normal speed (each sound
// lights up as it is said), then choose the word they make. The whole word is only
// spoken once the child has answered.
export function BlendSoundsRenderer({
  step,
  phase,
  lastResponse,
  reveal,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"BLEND_SOUNDS">>) {
  const { content } = step.question;
  const [active, setActive] = useState<number | null>(null);
  const [blending, setBlending] = useState(false);
  const locked = phase !== "answering";
  const chosen = lastResponse && "value" in lastResponse ? lastResponse.value : null;
  const answerId = phase === "correct" ? chosen : reveal?.optionId;
  const answerOption = content.options.find((o) => o.id === answerId);

  async function blend(speed: "slow" | "normal") {
    if (blending) return;
    setBlending(true);
    // One sequence: a new tap (or leaving the screen) stops it cleanly.
    // The sounds one by one with clear gaps (the child does the blending).
    await speak(
      content.units.map((u) => ({ text: u.sayAs, speed, intent: "PHONEME" as const })),
      speed,
      { onItem: setActive, sequence: "SEGMENTING" },
    );
    setActive(null);
    setBlending(false);
  }

  return (
    <div className="flex flex-col items-center gap-6">
      {content.emoji && locked ? (
        <span className="text-8xl" aria-hidden>
          {content.emoji}
        </span>
      ) : null}
      <PromptHeader step={step} speak={speak} />

      <ol className="flex flex-wrap items-center justify-center gap-2" aria-label="Sounds">
        {content.units.map((unit, i) => (
          <li key={i} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setActive(i);
                void speak(unit.sayAs, "slow", { intent: "PHONEME" }).then(() => setActive(null));
              }}
              aria-label={`Sound ${i + 1}: ${unit.grapheme}. Tap to hear.`}
              className={cn(
                "flex min-h-24 min-w-24 flex-col items-center justify-center rounded-3xl border-4 px-4 text-5xl font-extrabold shadow-sm transition",
                active === i ? "border-primary bg-sun/50 scale-110" : "bg-surface border-transparent",
              )}
            >
              {unit.grapheme}
              <span className="text-base" aria-hidden>
                🔊
              </span>
            </button>
            {i < content.units.length - 1 ? (
              <span className="text-muted text-3xl" aria-hidden>
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          disabled={blending}
          onClick={() => void blend("slow")}
          className="border-border bg-surface flex min-h-16 items-center gap-2 rounded-2xl border-2 px-5 text-xl font-bold shadow-sm"
        >
          <span aria-hidden>🐢</span> Slow blend
        </button>
        <button
          type="button"
          disabled={blending}
          onClick={() => void blend("normal")}
          className="bg-accent flex min-h-16 items-center gap-2 rounded-2xl px-5 text-xl font-bold text-white shadow-sm"
        >
          <span aria-hidden>🔗</span> Blend
        </button>
      </div>

      {answerOption ? (
        <p className="text-4xl font-extrabold" aria-live="polite">
          {content.units.map((u) => u.grapheme).join(" → ")} = {answerOption.text}
        </p>
      ) : null}

      <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3" role="group" aria-label="Answers">
        {content.options.map((option) => {
          const isChosen = chosen === option.id;
          const isAnswer = answerId === option.id;
          const showRight = (phase === "correct" && isChosen) || (phase === "reveal" && isAnswer);
          const showWrong = (phase === "retry" || phase === "reveal") && isChosen && !isAnswer;
          const label = option.text ?? option.id;
          return (
            <button
              key={option.id}
              type="button"
              disabled={locked}
              aria-label={`${label}${showRight ? " (right answer)" : showWrong ? " (not right)" : ""}`}
              onClick={() => onAnswer({ value: option.id })}
              className={cn(
                "bg-surface relative flex min-h-28 flex-col items-center justify-center gap-1 rounded-3xl border-4 p-3 shadow-sm transition enabled:active:scale-95",
                showRight
                  ? "border-success bg-success-soft"
                  : showWrong
                    ? "animate-wiggle border-danger bg-danger-soft"
                    : "border-transparent",
              )}
            >
              {option.emoji ? (
                <span className="text-5xl" aria-hidden>
                  {option.emoji}
                </span>
              ) : null}
              <span className="text-3xl font-bold" aria-hidden>
                {option.text}
              </span>
              {showRight ? <ResultMark ok /> : showWrong ? <ResultMark ok={false} /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
