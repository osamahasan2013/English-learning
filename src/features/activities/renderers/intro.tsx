"use client";

import { AudioControls } from "@/components/child/audio-controls";
import { splitHighlight } from "@/lib/learning/blending";
import type { QuestionOf, RendererProps } from "../types";

// Explanation / demonstration: the pattern, each of its sounds, and example words.
export function IntroRenderer({ step, speak }: RendererProps<QuestionOf<"INTRO">>) {
  const { content } = step.question;
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <p className="text-primary text-8xl font-extrabold tracking-wide sm:text-9xl" lang="en">
        {content.display ?? content.heading}
      </p>
      {content.letter ? <LetterNameAndSound letter={content.letter} speak={speak} /> : null}
      {content.body ? <p className="max-w-2xl text-2xl font-semibold">{content.body}</p> : null}
      <AudioControls text={content.speech || content.body || content.heading} speak={speak} />

      {step.pattern && step.pattern.sounds.length > 0 ? (
        <ul className="flex flex-wrap justify-center gap-3" aria-label="Sounds">
          {step.pattern.sounds.map((sound) => (
            <li key={sound.code}>
              <button
                type="button"
                onClick={() => void speak(sound.sayAs, "slow", { intent: "PHONEME" })}
                className="bg-accent-soft text-accent flex min-h-14 items-center gap-2 rounded-2xl px-4 text-xl font-bold"
              >
                <span aria-hidden>🔊</span> {sound.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {content.examples.length > 0 ? (
        <ul className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
          {content.examples.map((example) => {
            const parts = splitHighlight(example.text, example.highlight);
            return (
              <li key={example.text}>
                <button
                  type="button"
                  onClick={() => void speak(example.text, "normal", { intent: "WORD" })}
                  className="bg-surface flex w-full flex-col items-center gap-2 rounded-3xl p-4 shadow-sm"
                  aria-label={`${example.text}. Tap to hear.`}
                >
                  {example.emoji ? (
                    <span className="text-6xl" aria-hidden>
                      {example.emoji}
                    </span>
                  ) : null}
                  <span className="text-3xl font-bold" aria-hidden>
                    {parts.before}
                    {parts.match ? (
                      <mark className="bg-sun/40 rounded px-0.5 text-inherit">{parts.match}</mark>
                    ) : null}
                    {parts.after}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// A letter's name and its sound are two different things: two labelled buttons.
function LetterNameAndSound({
  letter,
  speak,
}: {
  letter: NonNullable<QuestionOf<"INTRO">["content"]["letter"]>;
  speak: RendererProps["speak"];
}) {
  return (
    <div className="grid w-full max-w-xl grid-cols-2 gap-3">
      <button
        type="button"
        onClick={() => void speak(letter.nameSpeech)}
        className="bg-surface flex min-h-24 flex-col items-center justify-center rounded-3xl p-3 shadow-sm"
      >
        <span className="text-muted text-lg font-bold">
          <span aria-hidden>📛 </span>Its name
        </span>
        <span className="text-3xl font-extrabold">{letter.name}</span>
      </button>
      <button
        type="button"
        onClick={() => void speak(letter.soundSpeech, "slow", { intent: "PHONEME" })}
        className="bg-accent-soft text-accent flex min-h-24 flex-col items-center justify-center rounded-3xl p-3 shadow-sm"
      >
        <span className="text-lg font-bold">
          <span aria-hidden>🔊 </span>Its sound
        </span>
        <span className="text-3xl font-extrabold">/{letter.soundLabel}/</span>
      </button>
    </div>
  );
}
