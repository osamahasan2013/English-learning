"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";
import { PromptHeader } from "./prompt-header";

// Sort items into groups: tap an item, then tap the group it belongs to. Items already
// in a group can be tapped to take them out again.
export function SortRenderer({
  step,
  phase,
  lastResponse,
  reveal,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"SORT">>) {
  const { content } = step.question;
  const answered = phase !== "answering";
  const [placed, setPlaced] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);

  const shown: Record<string, string> =
    phase === "reveal" && reveal?.pairs
      ? Object.fromEntries(reveal.pairs)
      : answered && lastResponse && "pairs" in lastResponse
        ? Object.fromEntries(lastResponse.pairs)
        : placed;
  const unsorted = content.items.filter((i) => !shown[i.id]);
  const label = (id: string) => {
    const item = content.items.find((i) => i.id === id)!;
    return item.text ?? item.speech ?? item.emoji ?? item.id;
  };

  function put(groupId: string) {
    if (answered || !selected) return;
    setPlaced((p) => ({ ...p, [selected]: groupId }));
    setSelected(null);
  }
  function takeOut(itemId: string) {
    if (answered) return;
    setPlaced((p) => {
      const next = { ...p };
      delete next[itemId];
      return next;
    });
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <PromptHeader step={step} speak={speak} />
      <div className="flex min-h-20 flex-wrap justify-center gap-3" role="group" aria-label="Things to sort">
        {unsorted.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={answered}
            aria-pressed={selected === item.id}
            aria-label={label(item.id)}
            onClick={() => {
              if (item.speech) void speak(item.speech);
              setSelected(item.id);
            }}
            className={cn(
              "bg-surface flex min-h-20 min-w-24 items-center justify-center gap-2 rounded-3xl border-4 px-4 shadow-sm transition enabled:active:scale-95",
              selected === item.id ? "border-primary" : "border-transparent",
            )}
          >
            {item.emoji ? (
              <span className="text-4xl" aria-hidden>
                {item.emoji}
              </span>
            ) : null}
            {item.text ? (
              <span className="text-3xl font-bold" aria-hidden>
                {item.text}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div
        className="grid w-full gap-4"
        style={{ gridTemplateColumns: `repeat(${content.groups.length}, minmax(0, 1fr))` }}
      >
        {content.groups.map((group) => {
          const inGroup = content.items.filter((i) => shown[i.id] === group.id);
          return (
            <section
              key={group.id}
              aria-label={group.label}
              className={cn(
                "flex min-h-40 flex-col items-center gap-3 rounded-3xl border-4 border-dashed p-3",
                phase === "correct"
                  ? "border-success bg-success-soft"
                  : phase === "retry"
                    ? "animate-wiggle border-danger bg-danger-soft"
                    : "border-primary/40 bg-surface",
              )}
            >
              <button
                type="button"
                disabled={answered || !selected}
                onClick={() => put(group.id)}
                className="bg-accent-soft text-accent flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl px-3 text-2xl font-extrabold"
              >
                {group.emoji ? <span aria-hidden>{group.emoji}</span> : null}
                {group.label}
                {selected ? <span className="sr-only"> — put {label(selected)} here</span> : null}
              </button>
              <ul className="flex flex-wrap justify-center gap-2">
                {inGroup.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={answered}
                      onClick={() => takeOut(item.id)}
                      aria-label={`${label(item.id)}, in ${group.label}${answered ? "" : ". Tap to take out"}`}
                      className="bg-primary flex min-h-14 items-center gap-1 rounded-2xl px-3 text-2xl font-bold text-white"
                    >
                      {item.emoji ? <span aria-hidden>{item.emoji}</span> : null}
                      {item.text ? <span aria-hidden>{item.text}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {!answered ? (
        <div className="flex gap-3">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => setPlaced({})}
            disabled={Object.keys(placed).length === 0}
          >
            <span aria-hidden>↺</span> Clear
          </Button>
          <Button
            variant="success"
            size="lg"
            onClick={() => onAnswer({ pairs: Object.entries(placed) as [string, string][] })}
            disabled={Object.keys(placed).length !== content.items.length}
          >
            <span aria-hidden>✓</span> Check
          </Button>
        </div>
      ) : null}
    </div>
  );
}
