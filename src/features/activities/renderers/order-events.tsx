"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";
import { PromptHeader } from "./prompt-header";
import { StoryPanel } from "./reading";

// Put the events of a story in order: tap the event that happened first, then the next…
// Each placed event gets its number; tap a placed event to take it back. Check when all are
// placed. Order is shown by numbers, not only by position or colour.
export function OrderEventsRenderer({
  step,
  phase,
  lastResponse,
  reveal,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"ORDER_EVENTS">>) {
  const { events } = step.question.content;
  const previous = lastResponse && "sequence" in lastResponse ? lastResponse.sequence : [];
  const [order, setOrder] = useState<string[]>(phase === "answering" ? [] : previous);
  const locked = phase !== "answering";
  const shown = phase === "reveal" && reveal?.sequence ? reveal.sequence : order;
  const byId = new Map(events.map((e) => [e.id, e]));
  const left = events.filter((e) => !shown.includes(e.id));
  const state = phase === "correct" ? "right" : phase === "retry" || phase === "reveal" ? "wrong" : "none";

  return (
    <div className="flex flex-col items-center gap-6">
      <StoryPanel step={step} speak={speak} />
      <PromptHeader step={step} speak={speak} />
      <ol
        aria-label="Your order"
        className={cn(
          "flex w-full max-w-2xl flex-col gap-3 rounded-3xl border-4 border-dashed p-4",
          state === "right"
            ? "border-success bg-success-soft"
            : state === "wrong" && phase !== "reveal"
              ? "animate-wiggle border-danger bg-danger-soft"
              : "border-primary/40 bg-surface",
        )}
      >
        {phase === "reveal" ? (
          <li className="text-lg font-bold">
            <span aria-hidden>👀 </span>Here is the right order:
          </li>
        ) : null}
        {events.map((_, slot) => {
          const id = shown[slot];
          const event = id ? byId.get(id) : null;
          return (
            <li key={slot} className="flex items-center gap-3">
              <span
                className="bg-primary flex size-12 shrink-0 items-center justify-center rounded-full text-2xl font-extrabold text-white"
                aria-hidden
              >
                {slot + 1}
              </span>
              {event ? (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => setOrder((o) => o.filter((x) => x !== event.id))}
                  aria-label={`${slot + 1}: ${event.text}${locked ? "" : ". Tap to take it back."}`}
                  className="bg-surface flex min-h-16 flex-1 items-center gap-3 rounded-2xl p-3 text-left text-xl font-bold shadow-sm"
                >
                  {event.emoji ? (
                    <span className="text-3xl" aria-hidden>
                      {event.emoji}
                    </span>
                  ) : null}
                  {event.text}
                </button>
              ) : (
                <span
                  className="border-border min-h-16 flex-1 rounded-2xl border-2 border-dashed"
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
      {!locked && left.length > 0 ? (
        <ul className="flex w-full max-w-2xl flex-col gap-3" aria-label="Events to place">
          {left.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => setOrder((o) => [...o, event.id])}
                className="bg-surface enabled:hover:border-primary flex min-h-16 w-full items-center gap-3 rounded-2xl border-4 border-transparent p-3 text-left text-xl font-bold shadow-sm"
              >
                {event.emoji ? (
                  <span className="text-3xl" aria-hidden>
                    {event.emoji}
                  </span>
                ) : null}
                {event.text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!locked ? (
        <Button
          size="xl"
          disabled={order.length !== events.length}
          onClick={() => onAnswer({ sequence: order })}
        >
          Check
        </Button>
      ) : null}
    </div>
  );
}
