"use client";

import { useState } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";

// Write a word or finish a sentence. Words from the bank can be tapped into the box
// (young writers copy before they spell), or typed.
export function WritingRenderer({ step, phase, onAnswer, speak }: RendererProps<QuestionOf<"WRITING">>) {
  const { content } = step.question;
  const [value, setValue] = useState("");
  const locked = phase !== "answering";
  const starter = content.starter?.trim() ?? "";

  function submit() {
    const typed = value.trim();
    if (!typed) return;
    onAnswer({ value: starter ? `${starter} ${typed}` : typed });
  }

  return (
    <form
      className="flex flex-col items-center gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {content.emoji ? (
        <span className="text-8xl" aria-hidden>
          {content.emoji}
        </span>
      ) : null}
      <p className="text-3xl font-extrabold">{step.prompt || "Write the word"}</p>
      <AudioControls text={step.promptSpeech || step.prompt} speak={speak} />
      {content.hint ? <p className="text-muted text-xl">{content.hint}</p> : null}
      <div className="flex w-full max-w-2xl flex-wrap items-center justify-center gap-3">
        {starter ? <span className="text-4xl font-bold">{starter}</span> : null}
        <label htmlFor={`write-${step.questionId}`} className="sr-only">
          {starter ? `Finish the sentence: ${starter}` : "Write your answer"}
        </label>
        <input
          id={`write-${step.questionId}`}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, 80))}
          disabled={locked}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn(
            "bg-surface min-h-20 min-w-0 flex-1 rounded-3xl border-4 px-6 text-center text-4xl font-extrabold",
            phase === "correct"
              ? "border-success bg-success-soft"
              : phase === "retry" || phase === "reveal"
                ? "animate-wiggle border-danger"
                : "border-primary/40",
          )}
        />
      </div>
      <div className="flex flex-wrap justify-center gap-3" role="group" aria-label="Word bank">
        {content.wordBank.map((word) => (
          <button
            key={word}
            type="button"
            disabled={locked}
            onClick={() => {
              void speak(word);
              setValue((v) => (v.trim() ? `${v.trim()} ${word}` : word));
            }}
            className="border-border bg-surface min-h-16 rounded-2xl border-4 px-5 text-3xl font-bold shadow-sm enabled:active:scale-95"
          >
            {word}
          </button>
        ))}
      </div>
      {!locked ? (
        <div className="flex gap-3">
          <Button type="button" variant="secondary" size="lg" onClick={() => setValue("")} disabled={!value}>
            <span aria-hidden>↺</span> Clear
          </Button>
          <Button type="submit" variant="success" size="xl" disabled={!value.trim()}>
            <span aria-hidden>✓</span> Check
          </Button>
        </div>
      ) : null}
    </form>
  );
}
