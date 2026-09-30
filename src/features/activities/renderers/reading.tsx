"use client";

import { AudioControls } from "@/components/child/audio-controls";
import type { QuestionOf, RendererProps } from "../types";
import { ChoiceRenderer } from "./choice";

// Reading comprehension: the activity's passage (from its configuration, shared by all
// its questions), which the child can listen to, then a question about it.
export function ReadingRenderer(props: RendererProps<QuestionOf<"READING">>) {
  const passage = props.step.activityConfig.passage;
  return (
    <div className="flex flex-col items-center gap-6">
      {passage ? (
        <article
          className="bg-surface w-full max-w-2xl space-y-3 rounded-[2rem] p-6 shadow-sm"
          aria-label="Story"
        >
          {passage.emoji ? (
            <p className="text-center text-6xl" aria-hidden>
              {passage.emoji}
            </p>
          ) : null}
          {passage.title ? <h2 className="text-center text-3xl font-extrabold">{passage.title}</h2> : null}
          <p className="text-2xl leading-relaxed font-semibold whitespace-pre-line">{passage.text}</p>
          {props.step.activityConfig.readAloud !== false ? (
            <AudioControls text={passage.text} speak={props.speak} className="justify-center" />
          ) : null}
        </article>
      ) : null}
      <ChoiceRenderer {...props} />
    </div>
  );
}
