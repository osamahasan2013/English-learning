"use client";

import { useState } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { PassageView } from "@/features/reading/passage-view";
import type { PassageRef } from "@/lib/content/question-schemas";
import type { LessonStep } from "@/lib/learning/lesson-payload";
import type { QuestionOf, RendererProps } from "../types";
import { ChoiceRenderer } from "./choice";

// Reading comprehension: the text the question is about — a story of the library (the
// activity's `story`) or a short inline passage — then a choice about it: multiple choice,
// true/false, or what a word means in the text. After answering, the sentence that holds
// the answer is pointed at so the child can look back.
export function ReadingRenderer(props: RendererProps<QuestionOf<"READING">>) {
  const { content } = props.step.question;
  const answered = props.phase === "correct" || props.phase === "reveal";
  return (
    <div className="flex flex-col items-center gap-6">
      <StoryPanel
        step={props.step}
        speak={props.speak}
        pointTo={answered ? (content.ref ?? null) : null}
        markWord={content.focusWord}
      />
      <ChoiceRenderer {...props} />
    </div>
  );
}

// The text for a question: the story (collapsible on small screens, so the question stays
// in view) or the inline passage.
export function StoryPanel({
  step,
  speak,
  pointTo = null,
  markWord,
}: Pick<RendererProps, "speak"> & { step: LessonStep; pointTo?: PassageRef | null; markWord?: string }) {
  const [open, setOpen] = useState(true);
  if (step.passage) {
    return (
      <div className="flex w-full max-w-2xl flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="text-primary flex min-h-12 items-center gap-2 rounded-xl px-3 text-lg font-bold"
        >
          <span aria-hidden>{open ? "📕" : "📖"}</span> {open ? "Hide the story" : "Look at the story"}
        </button>
        {open ? (
          <PassageView passage={step.passage} speak={speak} compact pointTo={pointTo} markWord={markWord} />
        ) : null}
      </div>
    );
  }
  const passage = step.activityConfig.passage;
  if (!passage) return null;
  return (
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
      {step.activityConfig.readAloud !== false ? (
        <AudioControls text={passage.text} speak={speak} className="justify-center" />
      ) : null}
    </article>
  );
}
