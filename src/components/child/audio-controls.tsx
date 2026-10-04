"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { stopAudio, type AudioSpeed, type PlayResult } from "@/lib/audio/audio-service";

// What a child sees when a press could not be heard. The words are always on screen, so
// nothing is blocked; trying again usually works (the engine was busy or still loading).
export function AudioUnavailable({ className }: { className?: string }) {
  return (
    <p role="status" className={cn("text-muted w-full text-lg font-semibold", className)}>
      <span aria-hidden>🔇 </span>Audio isn&apos;t available right now. Try again, or read the words.
    </p>
  );
}

// Listen, Slow and Again (repeats the last one), and Stop while something is playing.
// Large, icon-first, always labelled. Each press restarts the same words from the
// beginning (one voice at a time: the audio service stops the previous one first). Only
// the latest press decides what the buttons show.
export function AudioControls({
  text,
  speak,
  size = "lg",
  className,
}: {
  text: string;
  speak: (text: string, speed?: AudioSpeed) => Promise<PlayResult>;
  size?: "md" | "lg";
  className?: string;
}) {
  const [last, setLast] = useState<AudioSpeed | null>(null);
  const [playing, setPlaying] = useState<AudioSpeed | null>(null);
  const [silent, setSilent] = useState(false);
  const run = useRef(0);
  if (!text) return null;
  const base = size === "lg" ? "min-h-16 px-5 text-xl rounded-2xl" : "min-h-12 px-4 text-lg rounded-xl";
  const play = (speed: AudioSpeed) => {
    const mine = ++run.current;
    setLast(speed);
    setPlaying(speed);
    setSilent(false);
    void speak(text, speed).then((r) => {
      if (mine !== run.current) return;
      setPlaying(null);
      setSilent(r === "unavailable");
    });
  };
  const stop = () => {
    run.current++;
    setPlaying(null);
    stopAudio();
  };
  const active = (speed: AudioSpeed) => playing === speed && "ring-accent ring-4";
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} data-playing={playing ?? undefined}>
      <button
        type="button"
        onClick={() => play("normal")}
        className={cn(
          "bg-primary flex items-center gap-2 font-bold text-white shadow-sm",
          base,
          active("normal"),
        )}
      >
        <span aria-hidden>🔊</span> Listen
      </button>
      <button
        type="button"
        onClick={() => play("slow")}
        className={cn(
          "border-border bg-surface flex items-center gap-2 border-2 font-bold shadow-sm",
          base,
          active("slow"),
        )}
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
      {playing ? (
        <button
          type="button"
          onClick={stop}
          aria-label="Stop audio"
          className={cn(
            "border-border bg-surface flex items-center gap-2 border-2 font-bold shadow-sm",
            base,
          )}
        >
          <span aria-hidden>⏹️</span> Stop
        </button>
      ) : null}
      {silent ? <AudioUnavailable /> : null}
    </div>
  );
}

export function SpeakButton({
  text,
  speak,
  label,
}: {
  text: string;
  speak: (text: string, speed?: AudioSpeed) => Promise<PlayResult>;
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
