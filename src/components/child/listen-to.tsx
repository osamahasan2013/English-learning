"use client";

import { useCallback } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { useAudio } from "@/lib/audio/use-audio";
import type { AudioSpeed } from "@/lib/audio/audio-service";

// Listen / Slow / Again for a line of text on a server-rendered child screen.
export function ListenTo({ text, className }: { text: string; className?: string }) {
  const { speak: play } = useAudio();
  const speak = useCallback((t: string, speed: AudioSpeed = "normal") => play({ text: t, speed }), [play]);
  return <AudioControls text={text} speak={speak} size="md" className={className} />;
}
