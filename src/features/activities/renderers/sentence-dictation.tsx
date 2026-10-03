"use client";

import type { QuestionOf, RendererProps } from "../types";
import { DictationControls } from "./dictation-controls";
import { SpellingInput } from "./spelling-input";

// Sentence dictation: hear a sentence (limited replays, slow if allowed), write it. The
// answer is checked word by word, and for capitals / end marks when the question asks.
export function SentenceDictationRenderer({
  step,
  phase,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"SENTENCE_DICTATION">>) {
  const { content } = step.question;
  const settings = step.spelling;
  const locked = phase !== "answering";
  const state = phase === "correct" ? "right" : phase === "retry" || phase === "reveal" ? "wrong" : "none";
  const heard = step.promptSpeech.trim() === content.speech.trim();
  return (
    <div className="flex flex-col items-center gap-6">
      {content.emoji ? (
        <span className="text-7xl" aria-hidden>
          {content.emoji}
        </span>
      ) : null}
      <p className="text-center text-3xl font-extrabold">{step.prompt || "Write the sentence you hear"}</p>
      <DictationControls
        text={content.speech}
        speak={speak}
        limit={settings?.replayLimit ?? null}
        slow={settings?.slowReplay ?? true}
        alreadyPlayed={heard ? 1 : 0}
      />
      <p className="text-muted text-xl font-semibold">
        <span aria-hidden>🔢 </span>
        {content.wordCount} {content.wordCount === 1 ? "word" : "words"}
      </p>
      <SpellingInput
        id={`sentence-${step.questionId}`}
        method={settings?.input ?? "KEYBOARD"}
        slots={0}
        locked={locked}
        state={state}
        sentence
        onSubmit={(value) => onAnswer({ value })}
      />
    </div>
  );
}
