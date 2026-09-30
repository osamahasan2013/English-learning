"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { AudioSpeed } from "@/lib/audio/audio-service";

// Listen, Slow and Again (repeats the last one). Large, icon-first, always labelled. If
// the device cannot play sound, a visible note says so: the words are always on screen,
// so nothing is blocked.
export function AudioControls({
  text,
  speak,
  size = "lg",
  className,
}: {
  text: string;
  speak: (text: string, speed?: AudioSpeed) => Promise<unknown>;
  size?: "md" | "lg";
  className?: string;
}) {
  const [last, setLast] = useState<AudioSpeed | null>(null);
  const [silent, setSilent] = useState(false);
  if (!text) return null;
  const base = size === "lg" ? "min-h-16 px-5 text-xl rounded-2xl" : "min-h-12 px-4 text-lg rounded-xl";
  const play = (speed: AudioSpeed) => {
    setLast(speed);
    void speak(text, speed).then((played) => setSilent(played === false));
  };
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <button
        type="button"
        onClick={() => play("normal")}
        className={cn("bg-primary flex items-center gap-2 font-bold text-white shadow-sm", base)}
      >
        <span aria-hidden>🔊</span> Listen
      </button>
      <button
        type="button"
        onClick={() => play("slow")}
        className={cn("border-border bg-surface flex items-center gap-2 border-2 font-bold shadow-sm", base)}
      >
        <span aria-hidden>🐢</span> Slow
      </button>
      {last ? (
        <button
          type="button"
          onClick={() => play(last)}
          className={cn(
            "border-border bg-surface flex items-center gap-2 border-2 font-bold shadow-sm",
            base,
          )}
        >
          <span aria-hidden>🔁</span> Again
        </button>
      ) : null}
      {silent ? (
        <p role="status" className="text-muted w-full text-lg font-semibold">
          <span aria-hidden>🔇 </span>No sound right now. Read the words, or ask a grown-up.
        </p>
      ) : null}
    </div>
  );
}

export function SpeakButton({
  text,
  speak,
  label,
}: {
  text: string;
  speak: (text: string, speed?: AudioSpeed) => Promise<unknown>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => void speak(text, "normal")}
      aria-label={label}
      className="bg-accent-soft flex size-12 shrink-0 items-center justify-center rounded-full text-2xl"
    >
      <span aria-hidden>🔊</span>
    </button>
  );
}
