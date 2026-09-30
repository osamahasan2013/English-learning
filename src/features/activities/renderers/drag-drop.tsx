"use client";

import { useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";
import { PromptHeader } from "./prompt-header";

// Fill the blanks from a word bank. Tap a word to drop it into the next empty blank (tap
// a filled blank to send the word back); with a mouse, words can also be dragged onto a
// blank. Tap is the primary interaction because native drag-and-drop does not work on
// touch screens.
export function DragDropRenderer({
  step,
  phase,
  lastResponse,
  reveal,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"DRAG_DROP">>) {
  const { content } = step.question;
  const answered = phase !== "answering";
  const blanks = content.parts.filter((p) => "blank" in p).length;
  // Bank index per blank (null = empty).
  const [filled, setFilled] = useState<(number | null)[]>(() => Array.from({ length: blanks }, () => null));

  const words: (string | null)[] =
    phase === "reveal" && reveal?.sequence
      ? reveal.sequence
      : answered && lastResponse && "sequence" in lastResponse
        ? lastResponse.sequence
        : filled.map((i) => (i === null ? null : content.bank[i]));
  const used = new Set(filled.filter((i): i is number => i !== null));

  function place(bankIndex: number, blank?: number) {
    if (answered || used.has(bankIndex)) return;
    setFilled((f) => {
      const target = blank ?? f.findIndex((x) => x === null);
      if (target === -1) return f;
      const next = [...f];
      next[target] = bankIndex;
      return next;
    });
  }
  function clearBlank(blank: number) {
    if (answered) return;
    setFilled((f) => f.map((x, i) => (i === blank ? null : x)));
  }
  function onDrop(e: DragEvent, blank: number) {
    e.preventDefault();
    const data = e.dataTransfer.getData("text/plain");
    if (data.startsWith("bank:")) place(Number(data.slice(5)), blank);
  }

  let blankIndex = 0;
  return (
    <div className="flex flex-col items-center gap-6">
      {content.emoji ? (
        <span className="text-8xl" aria-hidden>
          {content.emoji}
        </span>
      ) : null}
      <PromptHeader step={step} speak={speak} />
      <p
        className={cn(
          "flex flex-wrap items-center justify-center gap-2 rounded-3xl p-4 text-4xl font-bold",
          phase === "correct" ? "bg-success-soft" : phase === "retry" ? "animate-wiggle bg-danger-soft" : "",
        )}
      >
        {content.parts.map((part, i) => {
          if ("text" in part) return <span key={i}>{part.text}</span>;
          const b = blankIndex++;
          const word = words[b];
          return (
            <button
              key={i}
              type="button"
              disabled={answered || word === null}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, b)}
              onClick={() => clearBlank(b)}
              aria-label={
                word ? `Blank ${b + 1}: ${word}${answered ? "" : ", tap to remove"}` : `Blank ${b + 1}, empty`
              }
              className={cn(
                "inline-flex min-h-16 min-w-28 items-center justify-center rounded-2xl border-4 border-dashed px-3",
                word ? "border-primary bg-primary text-white" : "border-primary/50 text-primary/40",
              )}
            >
              {word ?? "?"}
            </button>
          );
        })}
      </p>
      <div className="flex flex-wrap justify-center gap-3" role="group" aria-label="Word bank">
        {content.bank.map((word, i) => (
          <button
            key={`${word}-${i}`}
            type="button"
            draggable={!answered && !used.has(i)}
            onDragStart={(e) => e.dataTransfer.setData("text/plain", `bank:${i}`)}
            disabled={answered || used.has(i)}
            onClick={() => {
              void speak(word);
              place(i);
            }}
            className="border-border bg-surface min-h-16 rounded-2xl border-4 px-5 text-3xl font-extrabold shadow-sm transition enabled:active:scale-95 disabled:opacity-40"
          >
            {word}
          </button>
        ))}
      </div>
      {!answered ? (
        <div className="flex gap-3">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => setFilled((f) => f.map(() => null))}
            disabled={used.size === 0}
          >
            <span aria-hidden>↺</span> Clear
          </Button>
          <Button
            variant="success"
            size="lg"
            onClick={() => onAnswer({ sequence: filled.map((i) => content.bank[i!]) })}
            disabled={filled.some((i) => i === null)}
          >
            <span aria-hidden>✓</span> Check
          </Button>
        </div>
      ) : null}
    </div>
  );
}
