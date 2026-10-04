"use client";

import { useEffect, useRef, useState } from "react";
import { AudioUnavailable } from "@/components/child/audio-controls";
import {
  stopAudio,
  type AudioRequest,
  type AudioSpeed,
  type PlayResult,
  type SpeakFn,
} from "@/lib/audio/audio-service";
import type { PassageRef } from "@/lib/content/question-schemas";
import type { ReadingPassage } from "@/lib/learning/lesson-payload";
import { normalizeReadingWord, tokenizeWords } from "@/lib/learning/reading";
import { cn } from "@/lib/utils";

// A reading text on screen: large type, short lines, generous spacing, one paragraph per
// page of the story (a speaker's name for dialogue). Listen reads it sentence by sentence and
// highlights the sentence being read; for the youngest readers Slow reads it word by word and
// highlights each word (pointing at words as they are read). A recording of the whole text,
// when there is one, plays instead without highlighting (its timing is unknown). Tapping a
// word says it — and is reported as a word the child needed help with.
//
// Listen while it reads starts again from the first sentence; Slow restarts it slowly; a
// tapped word or Stop ends the reading. Only the latest of these decides the buttons and
// the highlight (an older reading that is cut short reports back late and is ignored).
// The highlight follows the speech engine sentence by sentence (or word by word); browser
// voices give no finer timing, so it is as exact as the engine allows, not word-perfect.
//
// Highlighting never relies on colour alone: the active sentence or word is also underlined
// and bold; focus vocabulary is underlined with a dotted line.

export type PassageListen = { speed: AudioSpeed };

type Props = {
  passage: ReadingPassage;
  speak: SpeakFn;
  // Word highlighting for the youngest readers, sentence highlighting otherwise.
  highlight?: "word" | "sentence";
  // A sentence to point at (the evidence for a question, after answering).
  pointTo?: PassageRef | null;
  // Smaller type and no controls (a question's look-back panel).
  compact?: boolean;
  // A word to mark (a word-meaning question).
  markWord?: string;
  onListen?: (listen: PassageListen) => void;
  onWordHelp?: (wordId: string | null, word: string) => void;
  // Start reading aloud as soon as the text appears (Read it again, after listening).
  autoListen?: AudioSpeed | null;
};

type Active = { sentence: number; word: number | null } | null;

export function PassageView({
  passage,
  speak,
  highlight = "sentence",
  pointTo = null,
  compact = false,
  markWord,
  onListen,
  onWordHelp,
  autoListen = null,
}: Props) {
  const [active, setActive] = useState<Active>(null);
  const [playing, setPlaying] = useState(false);
  const [silent, setSilent] = useState(false);
  // The latest reading; anything from an older one is ignored.
  const run = useRef(0);

  // Sentences in reading order, with their paragraph.
  const sentences = passage.paragraphs.flatMap((p, pi) => p.sentences.map((s, si) => ({ ...s, pi, si })));
  const marked = markWord ? normalizeReadingWord(markWord) : null;
  const focus = new Set(passage.focusWords);

  const begin = () => {
    const mine = ++run.current;
    const finish = (result: PlayResult) => {
      if (mine !== run.current) return;
      setPlaying(false);
      setActive(null);
      setSilent(result === "unavailable");
    };
    const at = (a: Active) => {
      if (mine === run.current) setActive(a);
    };
    return { finish, at };
  };

  // A replay for Read it again is part of the re-read, not a listen the child asked for.
  function listen(speed: AudioSpeed, report = true) {
    if (report) onListen?.({ speed });
    setPlaying(true);
    setSilent(false);
    setActive(null);
    const { finish, at } = begin();
    if (passage.audioUrl) {
      const text = sentences.map((s) => s.text).join(" ");
      void speak([{ text, assetUrl: passage.audioUrl, speed }]).then(finish);
      return;
    }
    if (speed === "slow" && highlight === "word") {
      // Word by word: each word of each sentence, pointed at as it is said.
      const items: { request: AudioRequest; at: Active }[] = sentences.flatMap((s, si) =>
        tokenizeWords(s.text).map((t, wi) => ({
          request: { text: t.text, speed },
          at: { sentence: si, word: wi },
        })),
      );
      void speak(
        items.map((i) => i.request),
        speed,
        { onItem: (i) => at(items[i]?.at ?? null) },
      ).then(finish);
      return;
    }
    void speak(
      sentences.map((s) => ({ text: s.text, speed })),
      speed,
      { onItem: (i) => at({ sentence: i, word: null }) },
    ).then(finish);
  }

  function sayWord(word: string) {
    const normalized = normalizeReadingWord(word);
    onWordHelp?.(passage.words[normalized] ?? null, normalized);
    // The word replaces the reading (one voice at a time): the story's buttons are ready
    // to start it again.
    run.current++;
    setPlaying(false);
    setActive(null);
    void speak(word, "slow");
  }

  function stop() {
    run.current++;
    setPlaying(false);
    setActive(null);
    stopAudio();
  }

  // Read it again: the new text starts reading by itself (still inside the child's tap).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoListen || autoStarted.current) return;
    autoStarted.current = true;
    listen(autoListen, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the text appears
  }, []);

  let sentenceIndex = -1;
  const textSize = compact
    ? "text-xl leading-relaxed"
    : highlight === "word"
      ? "text-3xl leading-[1.9] sm:text-4xl"
      : "text-2xl leading-[1.9] sm:text-3xl";

  return (
    <article
      aria-label={passage.title}
      className={cn(
        "bg-surface w-full rounded-[2rem] shadow-sm",
        compact ? "max-h-72 overflow-y-auto p-4" : "p-5 sm:p-8",
      )}
    >
      <header className={cn("flex flex-col items-center gap-2 text-center", compact ? "mb-2" : "mb-5")}>
        {passage.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- Storage URL, sized by CSS
          <img
            src={passage.image.url}
            alt={passage.image.alt}
            className={cn("rounded-2xl object-cover", compact ? "h-20" : "h-40 sm:h-52")}
          />
        ) : passage.emoji ? (
          <span className={compact ? "text-4xl" : "text-7xl"} aria-hidden>
            {passage.emoji}
          </span>
        ) : null}
        <h2 className={cn("font-extrabold", compact ? "text-xl" : "text-3xl sm:text-4xl")}>
          {passage.title}
        </h2>
      </header>

      {!compact ? (
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => listen("normal")}
            className="bg-primary flex min-h-16 items-center gap-2 rounded-2xl px-5 text-xl font-bold text-white shadow-sm"
          >
            <span aria-hidden>🔊</span> {playing ? "Start again" : "Listen"}
          </button>
          <button
            type="button"
            onClick={() => listen("slow")}
            className="border-border bg-surface flex min-h-16 items-center gap-2 rounded-2xl border-2 px-5 text-xl font-bold shadow-sm"
          >
            <span aria-hidden>🐢</span> Slow
          </button>
          {playing ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop audio"
              className="border-border bg-surface flex min-h-16 items-center gap-2 rounded-2xl border-2 px-5 text-xl font-bold shadow-sm"
            >
              <span aria-hidden>⏹️</span> Stop
            </button>
          ) : null}
          {silent ? <AudioUnavailable className="text-center" /> : null}
        </div>
      ) : null}

      <div className={cn("mx-auto max-w-[34ch] space-y-5 font-semibold sm:max-w-[42ch]", textSize)} lang="en">
        {passage.paragraphs.map((paragraph, pi) => (
          <div key={pi} className="flex gap-3">
            {paragraph.emoji && !compact ? (
              <span className="shrink-0 text-4xl leading-[1.6]" aria-hidden>
                {paragraph.emoji}
              </span>
            ) : null}
            <p>
              {paragraph.speaker ? (
                <span className="text-accent mr-2 font-extrabold">{paragraph.speaker}:</span>
              ) : null}
              {paragraph.sentences.map((sentence, si) => {
                sentenceIndex++;
                const index = sentenceIndex;
                const isActive = active?.sentence === index && active.word === null;
                const isPointed = pointTo?.paragraph === pi && pointTo.sentence === si;
                return (
                  <span
                    key={si}
                    data-sentence={index}
                    className={cn(
                      "rounded-lg transition-colors",
                      isActive && "bg-accent-soft underline decoration-4 underline-offset-8",
                      isPointed &&
                        "bg-success-soft decoration-success [box-decoration-break:clone] underline decoration-dashed decoration-2 underline-offset-8",
                    )}
                  >
                    {isPointed ? <span className="sr-only">The answer is here: </span> : null}
                    <SentenceWords
                      text={sentence.text}
                      activeWord={active?.sentence === index ? active.word : null}
                      focus={focus}
                      marked={marked}
                      onWord={sayWord}
                    />{" "}
                  </span>
                );
              })}
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}

// One sentence, each word a button (tap to hear it), punctuation as plain text.
function SentenceWords({
  text,
  activeWord,
  focus,
  marked,
  onWord,
}: {
  text: string;
  activeWord: number | null;
  focus: ReadonlySet<string>;
  marked: string | null;
  onWord: (word: string) => void;
}) {
  const tokens = tokenizeWords(text);
  const parts: React.ReactNode[] = [];
  let last = 0;
  tokens.forEach((t, i) => {
    if (t.start > last) parts.push(text.slice(last, t.start));
    const isActive = activeWord === i;
    const isFocus = focus.has(t.normalized);
    const isMarked = marked === t.normalized;
    parts.push(
      <button
        key={i}
        type="button"
        onClick={() => onWord(t.text)}
        className={cn(
          "hover:bg-accent-soft focus-visible:bg-accent-soft inline rounded-md px-0.5 py-1 font-[inherit]",
          isFocus && "decoration-accent underline decoration-dotted decoration-2 underline-offset-8",
          isMarked && "bg-warning-soft font-extrabold underline decoration-4 underline-offset-8",
          isActive && "bg-primary font-extrabold text-white underline decoration-4 underline-offset-8",
        )}
      >
        {t.text}
      </button>,
    );
    last = t.end;
  });
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
