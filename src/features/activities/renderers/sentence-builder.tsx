"use client";

import type { QuestionOf, RendererProps } from "../types";
import { PromptHeader } from "./prompt-header";
import { TileBoard } from "./tile-board";

export function SentenceBuilderRenderer({
  step,
  phase,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"SENTENCE_BUILDER">>) {
  const { content } = step.question;
  return (
    <div className="flex flex-col items-center gap-6">
      {content.emoji ? (
        <span className="text-8xl" aria-hidden>
          {content.emoji}
        </span>
      ) : null}
      <PromptHeader step={step} speak={speak} />
      <TileBoard
        size="sentence"
        tiles={content.tokens}
        slots={content.tokens.length}
        locked={phase !== "answering"}
        highlightState={
          phase === "correct" ? "right" : phase === "retry" || phase === "reveal" ? "wrong" : "none"
        }
        onCheck={(sequence) => onAnswer({ sequence })}
      />
    </div>
  );
}
