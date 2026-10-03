"use client";

import { PassageView } from "@/features/reading/passage-view";
import { useAudio } from "@/lib/audio/use-audio";
import type { ReadingPassage } from "@/lib/learning/lesson-payload";

// A text exactly as a child sees it in a reading lesson (admin preview), with working
// Listen / Slow and tap-to-hear words.
export function PassagePreview({
  passage,
  highlight,
}: {
  passage: ReadingPassage;
  highlight: "word" | "sentence";
}) {
  const { speak } = useAudio();
  return (
    <PassageView
      passage={passage}
      highlight={highlight}
      speak={(text, speed = "normal", options) =>
        speak(typeof text === "string" ? [{ text, speed }] : text, options)
      }
    />
  );
}
