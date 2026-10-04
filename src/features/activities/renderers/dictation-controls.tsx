"use client";

import { useRef, useState } from "react";
import { AudioUnavailable } from "@/components/child/audio-controls";
import type { AudioSpeed, PlayResult } from "@/lib/audio/audio-service";
import { cn } from "@/lib/utils";

// Dictation: Listen (and Slow, when the level allows it) with a limited number of plays.
// The limit and the slow button come from the step's spelling settings (activity config,
// else the level's spelling rules). Audio goes through the audio service (`speak`).
export function DictationControls({
  text,
  speak,
  limit,
  slow,
  alreadyPlayed = 0,
}: {
  text: string;
  speak: (text: string, speed?: AudioSpeed) => Promise<PlayResult>;
  // Plays allowed in total; null = no limit.
  limit: number | null;
  slow: boolean;
  // Plays that already happened (the prompt read aloud when the step opened).
  alreadyPlayed?: number;
}) {
  const [played, setPlayed] = useState(alreadyPlayed);
  const [silent, setSilent] = useState(false);
  const left = limit === null ? null : Math.max(0, limit - played);
  const out = left === 0;
  const run = useRef(0);
  const play = (speed: AudioSpeed) => {
    if (out) return;
    const mine = ++run.current;
    setPlayed((n) => n + 1);
    setSilent(false);
    void speak(text, speed).then((r) => {
      if (mine !== run.current) return;
      setSilent(r === "unavailable");
      // A listen that could not be heard does not count.
      if (r === "unavailable") setPlayed((n) => Math.max(0, n - 1));
    });
  };
  const base =
    "flex min-h-16 items-center gap-2 rounded-2xl px-5 text-xl font-bold shadow-sm disabled:opacity-50";
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => play("normal")}
          disabled={out}
          className={cn(base, "bg-primary text-white")}
        >
          <span aria-hidden>🔊</span> Listen
        </button>
        {slow ? (
          <button
            type="button"
            onClick={() => play("slow")}
            disabled={out}
            className={cn(base, "border-border bg-surface border-2")}
          >
            <span aria-hidden>🐢</span> Slow
          </button>
        ) : null}
      </div>
      {left !== null ? (
        <p className="text-muted text-lg font-semibold" aria-live="polite">
          {out ? (
            <>
              <span aria-hidden>👂 </span>No more listens. Do your best!
            </>
          ) : (
            <>
              <span aria-hidden>{"🔈".repeat(Math.min(left, 10))} </span>
              {left} {left === 1 ? "listen" : "listens"} left
            </>
          )}
        </p>
      ) : null}
      {silent ? <AudioUnavailable className="text-center" /> : null}
    </div>
  );
}
