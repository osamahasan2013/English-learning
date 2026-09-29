"use client";

import { cn } from "@/lib/utils";
import type { AudioSpeed } from "@/lib/audio/audio-service";

// Listen (tap again to repeat) and Slow. Large, icon-first, always labelled.
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
  if (!text) return null;
  const base = size === "lg" ? "min-h-16 px-5 text-xl rounded-2xl" : "min-h-12 px-4 text-lg rounded-xl";
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <button
        type="button"
        onClick={() => void speak(text, "normal")}
        className={cn("bg-primary flex items-center gap-2 font-bold text-white shadow-sm", base)}
      >
        <span aria-hidden>🔊</span> Listen
      </button>
      <button
        type="button"
        onClick={() => void speak(text, "slow")}
        className={cn("border-border bg-surface flex items-center gap-2 border-2 font-bold shadow-sm", base)}
      >
        <span aria-hidden>🐢</span> Slow
      </button>
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
