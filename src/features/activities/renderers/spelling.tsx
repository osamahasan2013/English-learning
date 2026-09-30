"use client";

import { useState } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";

// Type the word you hear.
export function SpellingRenderer({ step, phase, onAnswer, speak }: RendererProps<QuestionOf<"SPELLING">>) {
  const { content } = step.question;
  const [value, setValue] = useState("");
  const locked = phase !== "answering";
  // The loader always fills in the word to say (the child has to hear it).
  const word = content.speech ?? "";

  return (
    <form
      className="flex flex-col items-center gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onAnswer({ value });
      }}
    >
      {content.emoji ? (
        <span className="text-8xl" aria-hidden>
          {content.emoji}
        </span>
      ) : null}
      <p className="text-3xl font-extrabold">{step.prompt || "Type the word you hear"}</p>
      <AudioControls text={word} speak={speak} />
      {content.hint ? <p className="text-muted text-xl">{content.hint}</p> : null}
      <label htmlFor={`spell-${step.questionId}`} className="sr-only">
        Type the word
      </label>
      <input
        id={`spell-${step.questionId}`}
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 40))}
        disabled={locked}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          "bg-surface min-h-20 w-full max-w-md rounded-3xl border-4 px-6 text-center text-5xl font-extrabold tracking-widest",
          phase === "correct"
            ? "border-success bg-success-soft"
            : phase === "retry" || phase === "reveal"
              ? "animate-wiggle border-danger"
              : "border-primary/40",
        )}
      />
      {!locked ? (
        <Button type="submit" variant="success" size="xl" disabled={!value.trim()}>
          <span aria-hidden>✓</span> Check
        </Button>
      ) : null}
    </form>
  );
}
