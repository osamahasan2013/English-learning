"use client";

import { useEffect, useRef, useState } from "react";
import { PassageView } from "@/features/reading/passage-view";
import { stopAudio, type AudioSpeed } from "@/lib/audio/audio-service";
import { cn } from "@/lib/utils";
import type { QuestionOf, ReadingReport, RendererProps } from "../types";

const SELF_CHECKS = [
  { value: "easy", emoji: "😀", label: "Easy" },
  { value: "ok", emoji: "🙂", label: "OK" },
  { value: "hard", emoji: "😕", label: "Hard" },
] as const;

// Readings shorter than this are not reported (a quick tap through, or React's development
// double mount).
const MIN_REPORTED_MS = 3000;

// Guided reading of a story: listen first (the youngest) or read first, tap any word to hear
// it, read it again, and say how it went. Nothing here is scored; when the child leaves the
// text the player is told how the reading went (time on the text, listens, re-reads, words
// tapped) once, and records it as a reading session.
export function ReadPassageRenderer({ step, speak, onReading }: RendererProps<QuestionOf<"READ_PASSAGE">>) {
  const { content } = step.question;
  const passage = step.passage;
  const [selfCheck, setSelfCheck] = useState<ReadingReport["selfCheck"]>(null);
  const [finished, setFinished] = useState(false);
  const [rereads, setRereads] = useState(0);
  const [listened, setListened] = useState(false);
  const [readKey, setReadKey] = useState(0);
  // The speed of the child's last listen, and what Read it again replays (null: nothing).
  const lastSpeed = useRef<AudioSpeed | null>(null);
  const [replay, setReplay] = useState<AudioSpeed | null>(null);
  const top = useRef<HTMLDivElement>(null);

  // Everything the report needs, kept in a ref so the leave handler sees the latest values.
  const stats = useRef({
    // Set when the text is shown (below).
    startedAt: "",
    shownAt: 0,
    listens: 0,
    slowListens: 0,
    help: new Set<string>(),
    rereads: 0,
    selfCheck: null as ReadingReport["selfCheck"],
    reported: false,
  });

  // The latest callback and passage, so the leave handler below is installed only once (a
  // re-render must not count as leaving the text).
  const latest = useRef({ onReading, passage, mode: content.mode });
  useEffect(() => {
    latest.current = { onReading, passage, mode: content.mode };
  });

  useEffect(() => {
    const s = stats.current;
    if (!s.shownAt) {
      s.shownAt = Date.now();
      s.startedAt = new Date(s.shownAt).toISOString();
    }
    const report = () => {
      const { onReading, passage, mode } = latest.current;
      if (s.reported || !passage || !onReading) return;
      const durationMs = Math.min(3_600_000, Date.now() - s.shownAt);
      if (durationMs < MIN_REPORTED_MS) return;
      s.reported = true;
      onReading({
        storyId: passage.storyId,
        mode,
        startedAt: s.startedAt,
        durationMs,
        listens: s.listens,
        slowListens: s.slowListens,
        rereads: s.rereads,
        helpWordIds: [...s.help],
        selfCheck: s.selfCheck,
      });
    };
    window.addEventListener("pagehide", report);
    return () => {
      window.removeEventListener("pagehide", report);
      report();
    };
  }, []);

  if (!passage) return <p className="text-center text-2xl">Let&apos;s skip this one.</p>;

  const listenFirst = content.mode === "listen_first";
  const steps = listenFirst
    ? [
        { emoji: "👂", text: "Listen", done: listened },
        { emoji: "📖", text: "Read", done: finished },
      ]
    : [
        { emoji: "📖", text: "Read", done: finished },
        { emoji: "🔁", text: "Read again", done: rereads > 0 },
      ];

  return (
    <div ref={top} className="flex flex-col items-center gap-5">
      <ol className="flex flex-wrap justify-center gap-2" aria-label="Reading steps">
        {steps.map((s, i) => (
          <li
            key={s.text}
            className={cn(
              "flex min-h-12 items-center gap-2 rounded-full px-4 text-lg font-bold",
              s.done ? "bg-success-soft" : "bg-surface-muted",
            )}
          >
            <span aria-hidden>{s.done ? "✅" : s.emoji}</span>
            {i + 1}. {s.text}
            {s.done ? <span className="sr-only"> (done)</span> : null}
          </li>
        ))}
      </ol>

      <PassageView
        key={readKey}
        passage={passage}
        speak={speak}
        highlight={content.highlight}
        autoListen={replay}
        onListen={({ speed }) => {
          if (speed === "slow") stats.current.slowListens++;
          else stats.current.listens++;
          lastSpeed.current = speed;
          setListened(true);
        }}
        onWordHelp={(wordId) => {
          if (wordId) stats.current.help.add(wordId);
        }}
      />

      {!finished ? (
        <button
          type="button"
          onClick={() => setFinished(true)}
          className="bg-success flex min-h-16 items-center gap-2 rounded-2xl px-6 text-2xl font-extrabold text-white shadow-sm"
        >
          <span aria-hidden>📖</span> I read it!
        </button>
      ) : (
        <div className="flex w-full flex-col items-center gap-4">
          {content.selfCheck ? (
            <fieldset className="flex flex-col items-center gap-3">
              <legend className="mb-2 text-center text-2xl font-bold">How was it?</legend>
              <div className="flex gap-3">
                {SELF_CHECKS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    aria-pressed={selfCheck === c.value}
                    onClick={() => {
                      stats.current.selfCheck = c.value;
                      setSelfCheck(c.value);
                    }}
                    className={cn(
                      "bg-surface flex min-h-24 min-w-24 flex-col items-center justify-center gap-1 rounded-3xl border-4 text-xl font-bold shadow-sm",
                      selfCheck === c.value ? "border-primary" : "border-transparent",
                    )}
                  >
                    <span className="text-5xl" aria-hidden>
                      {c.emoji}
                    </span>
                    {c.label}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}
          <button
            type="button"
            onClick={() => {
              stats.current.rereads++;
              setRereads((n) => n + 1);
              // The text starts over from the top: read aloud again (at the child's last
              // speed) when they listened to it, or it is a listen-first story; otherwise a
              // reading still going is stopped and the child reads it again themselves.
              const again = lastSpeed.current ?? (listenFirst ? "normal" : null);
              if (!again) stopAudio();
              setReplay(again);
              setReadKey((k) => k + 1);
              top.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
            }}
            className="border-border bg-surface flex min-h-14 items-center gap-2 rounded-2xl border-2 px-5 text-xl font-bold"
          >
            <span aria-hidden>🔁</span> Read it again
          </button>
        </div>
      )}
    </div>
  );
}
