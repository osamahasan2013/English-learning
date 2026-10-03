"use client";

import { AudioControls } from "@/components/child/audio-controls";
import type { QuestionOf, RendererProps } from "../types";
import { DictationControls } from "./dictation-controls";
import { SpellingInput } from "./spelling-input";

// Write a word. Three ways to hear it (content.mode):
//   listen    — the picture and the word (Listen / Slow / Again): LISTEN_AND_TYPE
//   dictation — the word only, with the level's replay limit: DICTATION
//   sounds    — tap each sound, then write the word they make: SOUND_TO_WORD
// The input method (keyboard, child keyboard, letter tiles, drag and drop) comes from the
// step's spelling settings. Hints and the explanation of a mistake are shown by the player.
export function SpellingRenderer({ step, phase, onAnswer, speak }: RendererProps<QuestionOf<"SPELLING">>) {
  const { content } = step.question;
  const locked = phase !== "answering";
  // The loader always fills in the word to say (the child has to hear it).
  const word = content.speech ?? "";
  const settings = step.spelling;
  const mode = content.mode ?? "listen";
  const letters = content.split ? content.split.reduce((n, g) => n + g.grapheme.length, 0) : word.length;
  const state = phase === "correct" ? "right" : phase === "retry" || phase === "reveal" ? "wrong" : "none";
  const heard = step.promptSpeech.trim().toLowerCase() === word.trim().toLowerCase();

  async function playSounds() {
    await speak(
      (content.sounds ?? []).map((s) => ({ text: s.sayAs, speed: "slow" as const })),
      "slow",
    );
  }

  return (
    <div className="flex flex-col items-center gap-6">
      {mode === "listen" && content.emoji ? (
        <span className="text-8xl" aria-hidden>
          {content.emoji}
        </span>
      ) : null}
      <p className="text-center text-3xl font-extrabold">
        {step.prompt || (mode === "sounds" ? "What word do the sounds make?" : "Type the word you hear")}
      </p>
      {mode === "dictation" ? (
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
                onClick={() => void speak(sound.sayAs, "slow")}
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
        method={settings?.input ?? "KEYBOARD"}
        tiles={content.tiles}
        slots={letters}
        locked={locked}
        state={state}
        onSubmit={(value) => onAnswer({ value })}
      />
    </div>
  );
}
