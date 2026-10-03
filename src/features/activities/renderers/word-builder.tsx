"use client";

import { useState } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { segmentWord } from "@/lib/learning/blending";
import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";
import { TileBoard } from "./tile-board";

// Build the word: hear it, see it blended sound by sound (c → a → t → cat), then build it
// from sound tiles (BUILD_THE_WORD). In "scrambled" mode the tiles are the word's own
// letters, mixed up, and the child puts them back in order (SCRAMBLED_WORD).
export function WordBuilderRenderer({
  step,
  phase,
  lastResponse,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"WORD_BUILDER">>) {
  const { content } = step.question;
  // The loader always fills in the word to say: the child blends what they hear.
  const word = content.speech ?? "";
  const chunks = segmentWord(word, content.tiles);
  const [blendIndex, setBlendIndex] = useState<number | null>(null);
  const built = lastResponse && "sequence" in lastResponse ? lastResponse.sequence.join("") : null;
  const scrambled = content.mode === "scrambled";

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
      <p className="text-3xl font-extrabold">
        {step.prompt || (scrambled ? "Unscramble the word" : "Build the word")}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <AudioControls text={word} speak={speak} />
        {!scrambled ? (
          <button
            type="button"
            onClick={() => void demonstrate()}
            className="bg-accent flex min-h-16 items-center gap-2 rounded-2xl px-5 text-xl font-bold text-white shadow-sm"
          >
            <span aria-hidden>🔗</span> Blend
          </button>
        ) : null}
      </div>
      {!scrambled && (blendIndex !== null || content.demonstrateBlend) ? (
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
