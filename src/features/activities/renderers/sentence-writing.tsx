"use client";

import { useState } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { Button } from "@/components/ui/button";
import type { QuestionOf, RendererProps } from "../types";
import { appendWord, fieldState, WordBank, WritingChecklist, WritingField } from "./writing-parts";

// Write a sentence (content.mode):
//   copy     — the sentence is shown (and can be heard); write it (SENTENCE_COPY)
//   complete — a sentence with one gap; write the missing word(s) (SENTENCE_COMPLETION)
//   free     — write your own sentence about a picture or a prompt, with an optional
//              starter and word bank (SENTENCE_WRITING); judged by a rubric, not by
//              matching a stored sentence
export function SentenceWritingRenderer({
  step,
  phase,
  lastResponse,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"SENTENCE_WRITING">>) {
  const { content } = step.question;
  const locked = phase !== "answering";
  const previous = lastResponse && "value" in lastResponse ? lastResponse.value : "";
  const [value, setValue] = useState(locked ? previous : "");
  const state = fieldState(phase);
  const id = `sentence-${step.questionId}`;
  const starter = content.starter?.trim() ?? "";
  const showBank = step.activityConfig.wordBank !== false;

  function submit() {
    if (!value.trim()) return;
    onAnswer({ value: value.trim() });
  }

  const prompt =
    step.prompt ||
    (content.mode === "copy"
      ? "Copy the sentence"
      : content.mode === "complete"
        ? "Finish the sentence"
        : "Write a sentence");

  return (
    <form
      className="flex flex-col items-center gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {content.emoji ? (
        <span className="text-8xl" aria-hidden>
          {content.emoji}
        </span>
      ) : null}
      <p className="text-center text-3xl font-extrabold">{prompt}</p>
      <AudioControls
        text={content.mode === "copy" ? (content.model ?? "") : step.promptSpeech || step.prompt}
        speak={speak}
      />
      {content.mode === "copy" ? (
        <p
          className="bg-surface max-w-2xl rounded-3xl border-2 px-6 py-4 text-center text-4xl leading-snug font-extrabold"
          data-testid="model-sentence"
        >
          {content.model}
        </p>
      ) : null}
      {content.hint ? <p className="text-muted text-center text-xl">{content.hint}</p> : null}

      {content.mode === "complete" && content.parts ? (
        <p className="flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-2 text-4xl font-extrabold">
          {content.parts.map((part, i) =>
            "blank" in part ? (
              <span key={i} className="inline-block w-56">
                <WritingField
                  id={id}
                  label="The missing word"
                  value={value}
                  onChange={setValue}
                  locked={locked}
                  state={state}
                  maxLength={40}
                  big
                />
              </span>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
      ) : (
        <div className="flex w-full max-w-2xl flex-col gap-2">
          {starter ? (
            <p className="text-2xl font-bold">
              <span className="sr-only">Start with: </span>
              {starter} …
            </p>
          ) : null}
          <WritingField
            id={id}
            label={
              content.mode === "copy"
                ? "Write the sentence here"
                : starter
                  ? `Finish: ${starter}`
                  : "Write your sentence here"
            }
            value={value}
            onChange={setValue}
            locked={locked}
            state={state}
            multiline={content.mode === "free"}
            maxLength={300}
            big
          />
        </div>
      )}

      {content.mode === "free" && showBank ? (
        <WordBank
          words={content.wordBank}
          locked={locked}
          speak={speak}
          onPick={(w) => setValue((v) => appendWord(v, w))}
        />
      ) : null}
      {content.mode !== "complete" ? (
        <WritingChecklist step={step} units={[starter && value ? `${starter} ${value}` : value]} />
      ) : null}

      {!locked ? (
        <div className="flex gap-3">
          <Button type="button" variant="secondary" size="lg" onClick={() => setValue("")} disabled={!value}>
            <span aria-hidden>↺</span> Clear
          </Button>
          <Button type="submit" variant="success" size="xl" disabled={!value.trim()}>
            <span aria-hidden>✓</span> Check
          </Button>
        </div>
      ) : null}
    </form>
  );
}
