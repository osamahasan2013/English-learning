"use client";

import { useState } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { Button } from "@/components/ui/button";
import type { QuestionOf, RendererProps } from "../types";
import { fieldState, WritingField } from "./writing-parts";

const FOCUS: Record<string, { icon: string; text: string }> = {
  capitalization: { icon: "🔠", text: "Capital letters" },
  punctuation: { icon: "⏺", text: "End marks" },
  spelling: { icon: "🔤", text: "Spelling" },
  grammar: { icon: "🗣️", text: "Words that sound right" },
  spacing: { icon: "␣", text: "Spaces" },
};

// Find and fix the mistakes: the sentence is shown as written (with its mistakes) and put
// in the box; the child corrects it there. What to look for is shown as icons and words.
export function EditAndCorrectRenderer({
  step,
  phase,
  lastResponse,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"EDIT_AND_CORRECT">>) {
  const { content } = step.question;
  const locked = phase !== "answering";
  const previous = lastResponse && "value" in lastResponse ? lastResponse.value : null;
  const [value, setValue] = useState(locked && previous !== null ? previous : content.text);
  const changed = value.trim() !== content.text.trim();

  return (
    <form
      className="flex flex-col items-center gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onAnswer({ value: value.trim() });
      }}
    >
      {content.emoji ? (
        <span className="text-7xl" aria-hidden>
          {content.emoji}
        </span>
      ) : null}
      <p className="text-center text-3xl font-extrabold">{step.prompt || "Fix the sentence"}</p>
      <AudioControls text={step.promptSpeech || step.prompt || "Fix the sentence."} speak={speak} />
      <figure className="bg-warning-soft max-w-2xl rounded-3xl px-6 py-4 text-center">
        <figcaption className="text-muted text-lg font-semibold">
          <span aria-hidden>🔍 </span>This sentence has mistakes:
        </figcaption>
        <p className="text-3xl font-extrabold" data-testid="edit-original">
          {content.text}
        </p>
      </figure>
      <ul className="flex flex-wrap justify-center gap-2" aria-label="Look for">
        {content.focus.map((f) => (
          <li key={f} className="bg-surface rounded-2xl border-2 px-3 py-1 text-lg font-bold">
            <span aria-hidden>{FOCUS[f]?.icon} </span>
            {FOCUS[f]?.text ?? f}
          </li>
        ))}
      </ul>
      {content.hint ? <p className="text-muted text-center text-xl">{content.hint}</p> : null}
      <div className="w-full max-w-2xl">
        <WritingField
          id={`edit-${step.questionId}`}
          label="Write the sentence correctly"
          value={value}
          onChange={setValue}
          locked={locked}
          state={fieldState(phase)}
          multiline
          maxLength={300}
          big
        />
      </div>
      {!locked ? (
        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => setValue(content.text)}
            disabled={!changed}
          >
            <span aria-hidden>↺</span> Start again
          </Button>
          <Button type="submit" variant="success" size="xl" disabled={!value.trim()}>
            <span aria-hidden>✓</span> Check
          </Button>
        </div>
      ) : null}
    </form>
  );
}
