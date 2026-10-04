"use client";

import { useCallback } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { useAudio } from "@/lib/audio/use-audio";
import type { AudioIntent, AudioSpeed } from "@/lib/audio/audio-service";

// Listen / Slow / Again for a line of text on a server-rendered child screen. A recorded
// file (assetUrl) plays when there is one; otherwise the text is spoken.
export function ListenTo({
  text,
  assetUrl,
  intent,
  className,
}: {
  text: string;
  assetUrl?: string | null;
  // What the line is (a word is said whole; a sentence is paced for the child's level).
  intent?: AudioIntent;
  className?: string;
}) {
  const { speak: play } = useAudio();
  const speak = useCallback(
    (t: string, speed: AudioSpeed = "normal") =>
      play({ text: t, speed, intent, assetUrl: t === text ? (assetUrl ?? null) : null }),
    [play, text, assetUrl, intent],
  );
  return <AudioControls text={text} speak={speak} size="md" className={className} />;
}
