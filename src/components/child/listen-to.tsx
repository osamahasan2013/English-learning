"use client";

import { useCallback } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { useAudio } from "@/lib/audio/use-audio";
import type { AudioSpeed } from "@/lib/audio/audio-service";

// Listen / Slow / Again for a line of text on a server-rendered child screen. A recorded
// file (assetUrl) plays when there is one; otherwise the text is spoken.
export function ListenTo({
  text,
  assetUrl,
  className,
}: {
  text: string;
  assetUrl?: string | null;
  className?: string;
}) {
  const { speak: play } = useAudio();
  const speak = useCallback(
    (t: string, speed: AudioSpeed = "normal") =>
      play({ text: t, speed, assetUrl: t === text ? (assetUrl ?? null) : null }),
    [play, text, assetUrl],
  );
  return <AudioControls text={text} speak={speak} size="md" className={className} />;
}
