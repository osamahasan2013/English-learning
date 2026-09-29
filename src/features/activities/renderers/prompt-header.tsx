"use client";

import { AudioControls } from "@/components/child/audio-controls";
import type { RendererProps } from "../types";

// The question prompt: short text, big display (letter, word, passage) and Listen/Slow.
export function PromptHeader({
  step,
  speak,
  display,
}: Pick<RendererProps, "step" | "speak"> & { display?: string }) {
  const speech = step.promptSpeech || step.prompt;
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {step.prompt ? <p className="text-3xl font-extrabold">{step.prompt}</p> : null}
      {display ? (
        <p
          className={
            display.length > 24
              ? "max-w-2xl text-3xl leading-snug font-bold"
              : "text-primary text-7xl font-extrabold"
          }
        >
          {display}
        </p>
      ) : null}
      <AudioControls text={speech} speak={speak} />
    </div>
  );
}
