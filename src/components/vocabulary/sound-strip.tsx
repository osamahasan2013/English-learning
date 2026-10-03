"use client";

import { useAudio } from "@/lib/audio/use-audio";
import { cn } from "@/lib/utils";

// The word's grapheme split as tiles (c · a · t, sh · i · p): tap a tile to hear its
// sound, then "Blend" to hear the sounds and the whole word. Silent letters are shown
// faded and say nothing. Audio only through the audio service.
export function SoundStrip({
  word,
  segments,
}: {
  word: string;
  segments: { grapheme: string; sayAs: string; silent: boolean }[];
}) {
  const { speak } = useAudio();
  if (segments.length === 0) return null;
  const sounding = segments.filter((s) => !s.silent);
  async function blend() {
    await speak([
      ...sounding.map((s) => ({ text: s.sayAs, speed: "slow" as const })),
      { text: word, speed: "normal" },
    ]);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ul className="flex flex-wrap items-center gap-2" aria-label={`Sounds in ${word}`}>
        {segments.map((s, i) => (
          <li key={`${s.grapheme}-${i}`} className="flex items-center gap-2">
            {i > 0 ? (
              <span className="text-muted text-2xl" aria-hidden>
                ·
              </span>
            ) : null}
            <button
              type="button"
              disabled={s.silent}
              onClick={() => void speak({ text: s.sayAs, speed: "slow" })}
              aria-label={s.silent ? `${s.grapheme}, silent` : `${s.grapheme}: hear the sound`}
              className={cn(
                "bg-surface border-border min-h-16 min-w-16 rounded-2xl border-2 px-4 text-3xl font-extrabold shadow-sm",
                s.silent && "border-dashed opacity-40",
              )}
            >
              {s.grapheme}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => void blend()}
        className="bg-accent-soft text-accent min-h-16 rounded-2xl px-5 text-xl font-bold"
      >
        <span aria-hidden>🔗 </span>Blend
      </button>
    </div>
  );
}
