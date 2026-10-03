"use client";

import { useEffect, useRef, useState } from "react";
import type { AudioRequest, AudioSpeed, PlayResult, SpeakFn } from "@/lib/audio/audio-service";
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
}: Props) {
  const [active, setActive] = useState<Active>(null);
  const [playing, setPlaying] = useState(false);
  const [silent, setSilent] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Sentences in reading order, with their paragraph.
  const sentences = passage.paragraphs.flatMap((p, pi) => p.sentences.map((s, si) => ({ ...s, pi, si })));
  const marked = markWord ? normalizeReadingWord(markWord) : null;
  const focus = new Set(passage.focusWords);

  const finish = (result: PlayResult) => {
    if (!mounted.current) return;
    setPlaying(false);
    if (result !== "interrupted") setActive(null);
    setSilent(result === "unavailable");
  };

  function listen(speed: AudioSpeed) {
    onListen?.({ speed });
    setPlaying(true);
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
        { onItem: (i) => mounted.current && setActive(items[i]?.at ?? null) },
      ).then(finish);
      return;
    }
    void speak(
      sentences.map((s) => ({ text: s.text, speed })),
      speed,
      { onItem: (i) => mounted.current && setActive({ sentence: i, word: null }) },
    ).then(finish);
  }

  function sayWord(word: string) {
    const normalized = normalizeReadingWord(word);
    onWordHelp?.(passage.words[normalized] ?? null, normalized);
    void speak(word, "slow");
  }

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
          {silent ? (
            <p role="status" className="text-muted w-full text-center text-lg font-semibold">
              <span aria-hidden>🔇 </span>No sound right now. Read the words, or ask a grown-up.
            </p>
          ) : null}
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
