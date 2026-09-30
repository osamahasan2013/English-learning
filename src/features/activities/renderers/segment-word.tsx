"use client";

import { useState } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";

// Segmenting: hear the word, say how many sounds it has, then tap the sounds in order.
// Sound cards show phonemes between slashes (/sh/) and say the sound when tapped — they
// are sounds, not the word's letters.
export function SegmentWordRenderer({
  step,
  phase,
  lastResponse,
  reveal,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"SEGMENT_WORD">>) {
  const { content } = step.question;
  const locked = phase !== "answering";
  const [count, setCount] = useState<number | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const byId = new Map(content.sounds.map((s) => [s.id, s]));

  const shown: string[] =
    phase === "reveal" && reveal?.sequence
      ? reveal.sequence
      : locked && lastResponse && "sequence" in lastResponse
        ? lastResponse.sequence
        : picked;
  const slots = locked ? shown.length : (count ?? 0);

  function pick(id: string) {
    const sound = byId.get(id)!;
    void speak(sound.sayAs, "slow");
    if (locked || count === null || picked.length >= count) return;
    setPicked((p) => [...p, id]);
  }

  return (
    <div className="flex flex-col items-center gap-6">
      {content.emoji ? (
        <span className="text-8xl" aria-hidden>
          {content.emoji}
        </span>
      ) : null}
      <p className="text-3xl font-extrabold">{step.prompt || "How many sounds?"}</p>
      <p className="text-5xl font-extrabold">{content.word}</p>
      <AudioControls text={content.speech} speak={speak} />

      {!locked && count === null ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-2xl font-bold">How many sounds do you hear?</p>
          <div className="flex flex-wrap justify-center gap-3" role="group" aria-label="Number of sounds">
            {Array.from({ length: content.maxCount - 1 }, (_, i) => i + 2).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCount(n)}
                className="bg-surface min-h-20 min-w-20 rounded-3xl border-4 border-transparent text-4xl font-extrabold shadow-sm active:scale-95"
                aria-label={`${n} sounds`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <ol
            aria-label="Your sounds"
            className={cn(
              "flex min-h-24 flex-wrap items-center justify-center gap-3 rounded-3xl border-4 border-dashed p-4",
              phase === "correct"
                ? "border-success bg-success-soft"
                : phase === "retry" || phase === "reveal"
                  ? "border-danger bg-danger-soft animate-wiggle"
                  : "border-primary/40 bg-surface",
            )}
          >
            {Array.from({ length: slots }, (_, i) => {
              const sound = shown[i] ? byId.get(shown[i]) : undefined;
              return (
                <li key={i}>
                  {sound ? (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => setPicked((p) => p.filter((_, j) => j !== i))}
                      aria-label={`Sound ${i + 1}: /${sound.label}/${locked ? "" : ", tap to remove"}`}
                      className="bg-accent flex size-20 items-center justify-center rounded-full text-3xl font-extrabold text-white shadow"
                    >
                      /{sound.label}/
                    </button>
                  ) : (
                    <span
                      aria-label={`Sound ${i + 1}, empty`}
                      className="bg-surface-muted flex size-20 items-center justify-center rounded-full text-2xl"
                    >
                      {i + 1}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {!locked ? (
            <div className="flex flex-wrap justify-center gap-3" role="group" aria-label="Sound cards">
              {content.sounds.map((sound) => (
                <button
                  key={sound.id}
                  type="button"
                  onClick={() => pick(sound.id)}
                  aria-label={`/${sound.label}/`}
                  className="border-accent bg-accent-soft text-accent flex min-h-20 min-w-20 flex-col items-center justify-center rounded-full border-4 px-3 text-3xl font-extrabold shadow-sm active:scale-95"
                >
                  /{sound.label}/
                  <span className="text-sm" aria-hidden>
                    🔊
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {!locked ? (
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                variant="secondary"
                size="lg"
                onClick={() => {
                  setCount(null);
                  setPicked([]);
                }}
              >
                <span aria-hidden>🔢</span> Change number
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => setPicked([])}
                disabled={picked.length === 0}
              >
                <span aria-hidden>↺</span> Clear
              </Button>
              <Button
                variant="success"
                size="lg"
                disabled={picked.length !== count}
                onClick={() => onAnswer({ sequence: picked })}
              >
                <span aria-hidden>✓</span> Check
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
