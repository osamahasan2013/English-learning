"use client";

import { useState } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { soundToken } from "@/lib/audio/pronunciation";
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
  // The word's own grapheme split when the question has one (g · a · t · e, with a's sound
  // /EY/ and a silent e), else the tiles it is built from. Sounds come from the split,
  // never from a letter's usual sound (the a of gate is not the a of apple).
  const units = content.split
    ? content.split.map((g) => ({
        text: g.grapheme,
        sound: g.phonemes?.length ? soundToken(g.phonemes) : "",
      }))
    : segmentWord(word, content.tiles).map((c) => ({ text: c, sound: step.tileSounds[c] ?? "" }));
  const chunks = units.map((u) => u.text);
  const [blendIndex, setBlendIndex] = useState<number | null>(null);
  const built = lastResponse && "sequence" in lastResponse ? lastResponse.sequence.join("") : null;
  const scrambled = content.mode === "scrambled";

  async function demonstrate() {
    // Each SOUND on its own (never the raw letters, which a voice reads as letter names;
    // silent letters say nothing), then the whole word after a longer pause: a blend.
    const sounding = units.map((u, i) => ({ ...u, i })).filter((u) => u.sound);
    await speak(
      [
        ...sounding.map((u) => ({ text: u.sound, speed: "slow" as const, intent: "PHONEME" as const })),
        { text: word, speed: "normal", intent: "WORD" },
      ],
      "slow",
      {
        sequence: "BLENDING",
        onItem: (k) => setBlendIndex(k < sounding.length ? sounding[k].i : chunks.length),
      },
    );
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
