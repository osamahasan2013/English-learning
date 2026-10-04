"use client";

import { AudioControls } from "@/components/child/audio-controls";
import type { QuestionOf, RendererProps } from "../types";
import { DictationControls } from "./dictation-controls";
import { SpellingInput } from "./spelling-input";

// Write a word. The ways to meet it (content.mode):
//   listen    — the picture and the word (Listen / Slow / Again): LISTEN_AND_TYPE
//   dictation — the word only, with the level's replay limit: DICTATION
//   sounds    — tap each sound, then write the word they make: SOUND_TO_WORD
//   copy      — the word is shown (and can be heard); copy it: WORD_COPY
//   picture   — the picture; the word is only heard on request: IMAGE_TO_WORD
//   grapheme  — hear a sound, write the letter(s) that spell it: SOUND_TO_LETTER
// The input method (keyboard, child keyboard, letter tiles, drag and drop) comes from the
// step's spelling settings. Hints and the explanation of a mistake are shown by the player.
export function SpellingRenderer({ step, phase, onAnswer, speak }: RendererProps<QuestionOf<"SPELLING">>) {
  const { content } = step.question;
  const locked = phase !== "answering";
  const mode = content.mode ?? "listen";
  // The loader always fills in the word to say (the child has to hear it).
  const word = content.speech ?? "";
  const sound = mode === "grapheme" ? (content.sounds?.[0] ?? null) : null;
  const settings = step.spelling;
  // Grapheme mode without a split: the number of letters is not given away (tile input
  // falls back to the keyboard).
  const letters = content.split
    ? content.split.reduce((n, g) => n + g.grapheme.length, 0)
    : mode === "grapheme"
      ? 0
      : word.length;
  const state = phase === "correct" ? "right" : phase === "retry" || phase === "reveal" ? "wrong" : "none";
  const heard = step.promptSpeech.trim().toLowerCase() === word.trim().toLowerCase();

  async function playSounds() {
    await speak(
      (content.sounds ?? []).map((s) => ({
        text: s.sayAs,
        speed: "slow" as const,
        intent: "PHONEME" as const,
      })),
      "slow",
      { sequence: "SEGMENTING" },
    );
  }

  return (
    <div className="flex flex-col items-center gap-6">
      {(mode === "listen" || mode === "picture" || mode === "copy") && content.emoji ? (
        <span className="text-8xl" aria-hidden>
          {content.emoji}
        </span>
      ) : null}
      <p className="text-center text-3xl font-extrabold">
        {step.prompt ||
          (mode === "sounds"
            ? "What word do the sounds make?"
            : mode === "copy"
              ? "Copy the word"
              : mode === "picture"
                ? "What is it? Write the word."
                : mode === "grapheme"
                  ? "Write the letters for the sound"
                  : "Type the word you hear")}
      </p>
      {mode === "copy" ? (
        <div className="flex flex-col items-center gap-3">
          <p
            className="bg-surface text-primary rounded-3xl border-2 px-8 py-3 text-6xl font-extrabold tracking-wide"
            data-testid="model-word"
          >
            {word}
          </p>
          <AudioControls text={word} speak={speak} />
        </div>
      ) : mode === "picture" ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-muted text-lg font-semibold">Need help? Listen to the word.</p>
          <AudioControls text={word} speak={speak} size="md" />
        </div>
      ) : mode === "grapheme" ? (
        sound ? (
          <button
            type="button"
            onClick={() => void speak(sound.sayAs, "slow", { intent: "PHONEME" })}
            className="bg-accent flex min-h-20 items-center gap-3 rounded-3xl px-8 text-3xl font-extrabold text-white shadow-sm"
          >
            <span aria-hidden>🔊</span> Hear the sound
          </button>
        ) : null
      ) : mode === "dictation" ? (
        <DictationControls
          text={word}
          speak={speak}
          limit={settings?.replayLimit ?? null}
          slow={settings?.slowReplay ?? true}
          alreadyPlayed={heard ? 1 : 0}
        />
      ) : mode === "sounds" ? (
        <div className="flex flex-col items-center gap-3">
          <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Sounds">
            {(content.sounds ?? []).map((sound, i) => (
              <button
                key={i}
                type="button"
                onClick={() => void speak(sound.sayAs, "slow", { intent: "PHONEME" })}
                className="bg-accent-soft text-accent min-h-16 min-w-16 rounded-2xl px-4 text-3xl font-extrabold shadow-sm"
                aria-label={`Sound ${i + 1}: ${sound.label}`}
              >
                /{sound.label}/
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void playSounds()}
            className="bg-accent flex min-h-14 items-center gap-2 rounded-2xl px-5 text-xl font-bold text-white shadow-sm"
          >
            <span aria-hidden>🔗</span> All the sounds
          </button>
          {locked ? <AudioControls text={word} speak={speak} /> : null}
        </div>
      ) : (
        <AudioControls text={word} speak={speak} />
      )}
      {content.hint ? <p className="text-muted text-xl">{content.hint}</p> : null}
      <SpellingInput
        id={`spell-${step.questionId}`}
        method={
          letters === 0 && settings?.input && settings.input !== "KEYBOARD"
            ? "ON_SCREEN_KEYBOARD"
            : (settings?.input ?? "KEYBOARD")
        }
        tiles={content.tiles}
        slots={letters}
        locked={locked}
        state={state}
        onSubmit={(value) => onAnswer({ value })}
      />
    </div>
  );
}
