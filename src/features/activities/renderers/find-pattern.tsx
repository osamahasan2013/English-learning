"use client";

import { useState } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";

// Find the pattern in a word: tap the letters that make it ("sh" in "fish"). The chosen
// letters must sit next to each other.
export function FindPatternRenderer({
  step,
  phase,
  lastResponse,
  reveal,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"FIND_PATTERN">>) {
  const { content } = step.question;
  const locked = phase !== "answering";
  const [selected, setSelected] = useState<number[]>([]);
  const letters = [...content.word];

  const span = (value: string | undefined | null) => {
    const m = value?.match(/^(\d+)-(\d+)$/);
    return m ? { start: Number(m[1]), end: Number(m[2]) } : null;
  };
  const given = span(lastResponse && "value" in lastResponse ? lastResponse.value : null);
  const answer = phase === "reveal" ? span(reveal?.value) : phase === "correct" ? given : null;
  const sorted = [...selected].sort((a, b) => a - b);
  const contiguous = sorted.length > 0 && sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);

  function toggle(i: number) {
    if (locked) return;
    setSelected((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
  }

  return (
    <div className="flex flex-col items-center gap-6">
      {content.emoji ? (
        <span className="text-8xl" aria-hidden>
          {content.emoji}
        </span>
      ) : null}
      <p className="text-3xl font-extrabold">{step.prompt || `Find ${content.target}`}</p>
      {content.speech ? <AudioControls text={content.speech} speak={speak} /> : null}
      <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Letters in the word">
        {letters.map((letter, i) => {
          const inAnswer = answer !== null && i >= answer.start && i <= answer.end;
          const inWrong =
            (phase === "retry" || phase === "reveal") &&
            given !== null &&
            i >= given.start &&
            i <= given.end &&
            !inAnswer;
          const isSelected = !locked && selected.includes(i);
          return (
            <button
              key={i}
              type="button"
              disabled={locked}
              onClick={() => toggle(i)}
              aria-pressed={isSelected}
              aria-label={`Letter ${letter}${inAnswer ? " (part of the answer)" : ""}`}
              className={cn(
                "min-h-24 min-w-20 rounded-3xl border-4 px-3 text-6xl font-extrabold shadow-sm transition",
                inAnswer
                  ? "border-success bg-success-soft"
                  : inWrong
                    ? "border-danger bg-danger-soft"
                    : isSelected
                      ? "border-primary bg-sun/50"
                      : "bg-surface border-transparent",
              )}
            >
              {letter}
            </button>
          );
        })}
      </div>
      {!locked ? (
        <div className="flex gap-3">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => setSelected([])}
            disabled={selected.length === 0}
          >
            <span aria-hidden>↺</span> Clear
          </Button>
          <Button
            variant="success"
            size="lg"
            disabled={!contiguous}
            onClick={() => onAnswer({ value: `${sorted[0]}-${sorted[sorted.length - 1]}` })}
          >
            <span aria-hidden>✓</span> Check
          </Button>
        </div>
      ) : null}
    </div>
  );
}
