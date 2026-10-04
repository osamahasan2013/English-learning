"use client";

import { useRef, useState } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { Button } from "@/components/ui/button";
import type { QuestionOf, RendererProps } from "../types";
import { appendWord, fieldState, WordBank, WritingChecklist, WritingField } from "./writing-parts";

// Guided and paragraph writing (content.layout):
//   frames    — one box per sentence frame, each with its starter ("I see a …")
//   paragraph — labelled boxes for the parts of a paragraph (topic sentence, details, ending)
//   free      — one big box
// Scaffolding shrinks with the level: KG3 gets frames with starters, Grade 2 a free box.
// The answer is the boxes as written; a rubric decides (writing.ts), never a stored text.
export function GuidedWritingRenderer({
  step,
  phase,
  lastResponse,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"GUIDED_WRITING">>) {
  const { content } = step.question;
  const locked = phase !== "answering";
  const previous = lastResponse && "lines" in lastResponse ? lastResponse.lines : [];
  const [lines, setLines] = useState<string[]>(() =>
    content.frames.map((_, i) => (locked ? (previous[i] ?? "") : "")),
  );
  const focused = useRef(0);
  const state = fieldState(phase);
  const showBank = step.activityConfig.wordBank !== false;
  const written = lines.some((l) => l.trim());

  const set = (i: number, v: string) => setLines((all) => all.map((l, j) => (j === i ? v : l)));
  const units = content.frames.map((f, i) => {
    const typed = lines[i]?.trim() ?? "";
    const starter = f.starter?.trim();
    return typed && starter && !typed.toLowerCase().startsWith(starter.toLowerCase())
      ? `${starter} ${typed}`
      : typed;
  });

  return (
    <form
      className="flex flex-col items-center gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (written) onAnswer({ lines: lines.map((l) => l.trim()) });
      }}
    >
      {content.emoji ? (
        <span className="text-8xl" aria-hidden>
          {content.emoji}
        </span>
      ) : null}
      <p className="text-center text-3xl font-extrabold">{step.prompt || content.topic}</p>
      <AudioControls text={step.promptSpeech || step.prompt || content.topic} speak={speak} />
      {step.prompt && step.prompt !== content.topic ? (
        <p className="text-muted text-center text-xl">
          <span aria-hidden>💭 </span>
          {content.topic}
        </p>
      ) : null}

      <ol className="flex w-full max-w-2xl flex-col gap-4">
        {content.frames.map((frame, i) => {
          const label =
            frame.label ||
            (content.layout === "frames"
              ? `Sentence ${i + 1}`
              : content.layout === "free"
                ? "My writing"
                : `Part ${i + 1}`);
          return (
            <li key={i} className="flex flex-col gap-1">
              <label htmlFor={`guided-${step.questionId}-${i}`} className="text-xl font-bold">
                {content.frames.length > 1 ? (
                  <span
                    className="bg-primary mr-2 inline-flex size-8 items-center justify-center rounded-full text-white"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                ) : null}
                {label}
              </label>
              <div className="flex flex-wrap items-baseline gap-2">
                {frame.starter ? <span className="text-2xl font-bold">{frame.starter}</span> : null}
                <div className="min-w-0 flex-1">
                  <WritingField
                    id={`guided-${step.questionId}-${i}`}
                    label={frame.starter ? `${label}: ${frame.starter} …` : label}
                    value={lines[i] ?? ""}
                    onChange={(v) => set(i, v)}
                    onFocus={() => (focused.current = i)}
                    locked={locked}
                    state={state}
                    multiline={content.layout !== "frames"}
                    placeholder={frame.placeholder}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {showBank ? (
        <WordBank
          words={content.wordBank}
          locked={locked}
          speak={speak}
          onPick={(w) => set(focused.current, appendWord(lines[focused.current] ?? "", w))}
        />
      ) : null}
      <WritingChecklist step={step} units={units} extra={content.checklist} />

      {!locked ? (
        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => setLines(content.frames.map(() => ""))}
            disabled={!written}
          >
            <span aria-hidden>↺</span> Clear
          </Button>
          <Button type="submit" variant="success" size="xl" disabled={!written}>
            <span aria-hidden>✓</span> Check
          </Button>
        </div>
      ) : null}
    </form>
  );
}
