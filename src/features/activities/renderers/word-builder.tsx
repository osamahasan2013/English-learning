"use client";

import { useState } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { segmentWord } from "@/lib/learning/blending";
import type { AcceptedAnswer, WordBuilderContent } from "@/lib/content/question-schemas";
import { cn } from "@/lib/utils";
import type { RendererProps } from "../types";
import { TileBoard } from "./tile-board";

// Blending: hear the word, see it blended sound by sound (c → a → t → cat), then build it.
export function WordBuilderRenderer({
  step,
  phase,
  lastResponse,
  onAnswer,
  speak,
}: RendererProps<{ type: "WORD_BUILDER"; content: WordBuilderContent; answer: AcceptedAnswer }>) {
  const { content, answer } = step.question;
  const word = content.speech ?? answer.accepted[0];
  const chunks = segmentWord(answer.accepted[0], content.tiles);
  const [blendIndex, setBlendIndex] = useState<number | null>(null);
  const built = lastResponse && "sequence" in lastResponse ? lastResponse.sequence.join("") : null;

  async function demonstrate() {
    for (let i = 0; i < chunks.length; i++) {
      setBlendIndex(i);
      await speak(step.tileSounds[chunks[i]] ?? chunks[i], "slow");
    }
    setBlendIndex(chunks.length);
    await speak(word, "normal");
    setBlendIndex(null);
  }

  return (
    <div className="flex flex-col items-center gap-6">
      {content.emoji ? (
        <span className="text-8xl" aria-hidden>
          {content.emoji}
        </span>
      ) : null}
      <p className="text-3xl font-extrabold">{step.prompt || "Build the word"}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <AudioControls text={word} speak={speak} />
        <button
          type="button"
          onClick={() => void demonstrate()}
          className="bg-accent flex min-h-16 items-center gap-2 rounded-2xl px-5 text-xl font-bold text-white shadow-sm"
        >
          <span aria-hidden>🔗</span> Blend
        </button>
      </div>
      {blendIndex !== null || content.demonstrateBlend ? (
        <p className="flex items-center gap-2 text-4xl font-extrabold" aria-live="polite">
          {chunks.map((chunk, i) => (
            <span key={i} className="flex items-center gap-2">
              <span className={cn("rounded-xl px-2", blendIndex === i ? "bg-sun/50" : "text-muted")}>
                {chunk}
              </span>
              {i < chunks.length - 1 ? (
                <span aria-hidden className="text-muted">
                  →
                </span>
              ) : null}
            </span>
          ))}
          <span aria-hidden className="text-muted">
            =
          </span>
          <span
            className={cn(
              "rounded-xl px-2",
              blendIndex === chunks.length ? "bg-success-soft text-success" : "text-muted",
            )}
          >
            {blendIndex === null && !content.demonstrateBlend ? "?" : word}
          </span>
        </p>
      ) : null}
      <TileBoard
        tiles={content.tiles}
        slots={content.slots}
        locked={phase !== "answering"}
        highlightState={
          phase === "correct" ? "right" : phase === "retry" || phase === "reveal" ? "wrong" : "none"
        }
        onCheck={(sequence) => onAnswer({ sequence })}
      />
      {phase === "reveal" && built !== null ? (
        <p className="text-2xl">
          You built <span className="font-extrabold">{built}</span>.
        </p>
      ) : null}
    </div>
  );
}
