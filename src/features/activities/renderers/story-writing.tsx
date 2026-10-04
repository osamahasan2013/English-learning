"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";
import { PromptHeader } from "./prompt-header";
import { StoryPanel } from "./reading";
import { appendWord, fieldState, WordBank, WritingChecklist, WritingField } from "./writing-parts";

// Story sequence writing: put the story's pictures in order (tap them in the order they
// happened; tap a placed one to take it back), then write a sentence for each picture —
// at Grade 2 joined with sequence words (content.connect). The story is the activity's
// story (config.story), shown above. The sentences stay with their picture when the
// order changes.
export function StoryOrderWritingRenderer({
  step,
  phase,
  lastResponse,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"STORY_ORDER_WRITING">>) {
  const { content } = step.question;
  const locked = phase !== "answering";
  const previous = lastResponse && "lines" in lastResponse ? lastResponse : null;
  const [order, setOrder] = useState<string[]>(locked && previous?.order ? previous.order : []);
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    locked && previous?.order
      ? Object.fromEntries(previous.order.map((id, i) => [id, previous.lines[i] ?? ""]))
      : {},
  );
  const [focused, setFocused] = useState<string | null>(null);
  const state = fieldState(phase);
  const byId = new Map(content.events.map((e) => [e.id, e]));
  const left = content.events.filter((e) => !order.includes(e.id));
  const placed = order.length === content.events.length;
  const lines = order.map((id) => (texts[id] ?? "").trim());
  const showBank = step.activityConfig.wordBank !== false;

  return (
    <form
      className="flex flex-col items-center gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (placed && lines.some(Boolean)) onAnswer({ lines, order });
      }}
    >
      {step.activityConfig.showStory !== false ? <StoryPanel step={step} speak={speak} /> : null}
      <PromptHeader step={step} speak={speak} />

      <section className="flex w-full max-w-2xl flex-col gap-3" aria-label="Pictures to put in order">
        <p className="text-xl font-bold">
          <span aria-hidden>1️⃣ </span>Tap the pictures in order.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {left.map((e) => (
            <button
              key={e.id}
              type="button"
              disabled={locked}
              onClick={() => setOrder((o) => [...o, e.id])}
              className="border-border bg-surface flex min-h-24 min-w-24 flex-col items-center justify-center rounded-3xl border-4 p-2 shadow-sm enabled:active:scale-95"
              aria-label={`Add picture: ${e.label || e.emoji}`}
            >
              <span className="text-5xl" aria-hidden>
                {e.emoji}
              </span>
              {e.label ? <span className="text-base font-semibold">{e.label}</span> : null}
            </button>
          ))}
          {left.length === 0 ? <p className="text-muted text-lg">All the pictures are in order.</p> : null}
        </div>
      </section>

      <ol
        aria-label="Your story"
        className={cn(
          "flex w-full max-w-2xl flex-col gap-4 rounded-3xl border-4 border-dashed p-4",
          state === "right" ? "border-success" : state === "wrong" ? "border-danger" : "border-primary/40",
        )}
      >
        {order.length === 0 ? (
          <li className="text-muted text-center text-lg">Your pictures go here.</li>
        ) : null}
        {order.map((id, i) => {
          const event = byId.get(id);
          if (!event) return null;
          const starter = content.starters[i];
          return (
            <li key={id} className="flex items-start gap-3">
              <button
                type="button"
                disabled={locked}
                onClick={() => setOrder((o) => o.filter((x) => x !== id))}
                className="bg-surface flex min-h-20 min-w-20 shrink-0 flex-col items-center justify-center rounded-2xl border-2 shadow-sm"
                aria-label={`Picture ${i + 1}: ${event.label || event.emoji}. Tap to take it back.`}
              >
                <span className="text-sm font-extrabold">{i + 1}</span>
                <span className="text-4xl" aria-hidden>
                  {event.emoji}
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <WritingField
                  id={`story-${step.questionId}-${id}`}
                  label={`Sentence for picture ${i + 1}${starter ? `, starting with ${starter}` : ""}`}
                  placeholder={starter ? `${starter} …` : "What happens?"}
                  value={texts[id] ?? ""}
                  onChange={(v) => setTexts((t) => ({ ...t, [id]: v }))}
                  onFocus={() => setFocused(id)}
                  locked={locked}
                  state={state}
                  multiline
                />
              </div>
            </li>
          );
        })}
      </ol>
      {content.connect ? (
        <p className="text-muted text-center text-lg">
          <span aria-hidden>🔗 </span>Use words like first, next, then and at the end.
        </p>
      ) : null}

      {showBank ? (
        <WordBank
          words={content.wordBank}
          locked={locked || !focused}
          speak={speak}
          onPick={(w) => focused && setTexts((t) => ({ ...t, [focused]: appendWord(t[focused] ?? "", w) }))}
        />
      ) : null}
      <WritingChecklist step={step} units={lines} />

      {!locked ? (
        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => setOrder([])}
            disabled={order.length === 0}
          >
            <span aria-hidden>↺</span> Start again
          </Button>
          <Button type="submit" variant="success" size="xl" disabled={!placed || !lines.some(Boolean)}>
            <span aria-hidden>✓</span> Check
          </Button>
        </div>
      ) : null}
    </form>
  );
}
