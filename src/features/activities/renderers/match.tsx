"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";
import { ResultMark } from "./choice";
import { PromptHeader } from "./prompt-header";
import { StoryPanel } from "./reading";

type Item = { id: string; text?: string; emoji?: string; speech?: string };

const label = (item: Item) => item.text ?? item.speech ?? item.emoji ?? item.id;

// Match pairs: tap an item on the left, then its partner on the right. Each pair gets a
// number badge (not just a colour), and tapping a paired item undoes the pair.
export function MatchRenderer({
  step,
  phase,
  lastResponse,
  reveal,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"MATCH">>) {
  const { content } = step.question;
  const answered = phase !== "answering";
  const [pairs, setPairs] = useState<[string, string][]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const shown: [string, string][] =
    phase === "reveal" && reveal?.pairs
      ? reveal.pairs
      : answered && lastResponse && "pairs" in lastResponse
        ? lastResponse.pairs
        : pairs;
  const correctSet = new Set((reveal?.pairs ?? []).map(([l, r]) => `${l}=${r}`));
  const badge = (side: 0 | 1, id: string) => {
    const i = shown.findIndex((p) => p[side] === id);
    return i === -1 ? null : i + 1;
  };

  function tapLeft(id: string) {
    if (answered) return;
    if (pairs.some((p) => p[0] === id)) setPairs((p) => p.filter((x) => x[0] !== id));
    setSelected(id);
  }
  function tapRight(id: string) {
    if (answered) return;
    if (pairs.some((p) => p[1] === id)) {
      setPairs((p) => p.filter((x) => x[1] !== id));
      return;
    }
    if (!selected) return;
    setPairs((p) => [...p.filter((x) => x[0] !== selected), [selected, id]]);
    setSelected(null);
  }

  const column = (items: Item[], side: 0 | 1) => (
    <ul className="flex flex-col gap-3" aria-label={side === 0 ? "Match these" : "With these"}>
      {items.map((item) => {
        const n = badge(side, item.id);
        const pair = shown.find((p) => p[side] === item.id);
        const verdict =
          phase === "correct" && pair
            ? true
            : phase === "reveal" && pair
              ? correctSet.has(`${pair[0]}=${pair[1]}`)
              : null;
        return (
          <li key={item.id}>
            <button
              type="button"
              disabled={answered}
              aria-pressed={side === 0 ? selected === item.id : n !== null}
              aria-label={`${label(item)}${n ? `, pair ${n}` : ""}`}
              onClick={() => {
                if (item.speech) void speak(item.speech);
                if (side === 0) tapLeft(item.id);
                else tapRight(item.id);
              }}
              className={cn(
                "bg-surface relative flex min-h-24 w-full items-center justify-center gap-3 rounded-3xl border-4 p-3 shadow-sm transition enabled:active:scale-95",
                side === 0 && selected === item.id ? "border-primary" : "border-transparent",
                phase === "retry" && "animate-wiggle",
              )}
            >
              {item.emoji ? (
                <span className="text-5xl" aria-hidden>
                  {item.emoji}
                </span>
              ) : null}
              {item.text ? (
                <span className="text-3xl font-bold" aria-hidden>
                  {item.text}
                </span>
              ) : null}
              {n ? (
                <span
                  className="bg-accent absolute top-2 left-2 flex size-8 items-center justify-center rounded-full text-lg font-extrabold text-white"
                  aria-hidden
                >
                  {n}
                </span>
              ) : null}
              {verdict !== null ? <ResultMark ok={verdict} /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex flex-col items-center gap-6">
      <StoryPanel step={step} speak={speak} />
      <PromptHeader step={step} speak={speak} />
      <div className="grid w-full max-w-2xl grid-cols-2 gap-6">
        {column(content.left, 0)}
        {column(content.right, 1)}
      </div>
      {!answered ? (
        <div className="flex gap-3">
          <Button variant="secondary" size="lg" onClick={() => setPairs([])} disabled={pairs.length === 0}>
            <span aria-hidden>↺</span> Clear
          </Button>
          <Button
            variant="success"
            size="lg"
            onClick={() => onAnswer({ pairs })}
            disabled={pairs.length !== content.left.length}
          >
            <span aria-hidden>✓</span> Check
          </Button>
        </div>
      ) : null}
    </div>
  );
}
