"use client";

import { useState, useTransition } from "react";
import { setWordSaved } from "@/app/child/words/actions";
import { cn } from "@/lib/utils";

// Save / remove a word from My Words. The state is shown with an icon AND words, never by
// colour alone; a failure says so in child terms.
export function SaveWordButton({
  wordId,
  word,
  saved: initial,
  compact = false,
}: {
  wordId: string;
  word: string;
  saved: boolean;
  compact?: boolean;
}) {
  const [saved, setSaved] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const toggle = () =>
    start(async () => {
      const result = await setWordSaved(wordId, !saved).catch(() => ({ ok: false as const }));
      setFailed(!result.ok);
      if (result.ok) setSaved(result.saved);
    });
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={saved}
        aria-label={
          compact ? (saved ? `Remove ${word} from My Words` : `Save ${word} to My Words`) : undefined
        }
        className={cn(
          "flex items-center gap-2 rounded-2xl border-2 font-bold shadow-sm transition disabled:opacity-60",
          compact ? "min-h-12 px-3 text-lg" : "min-h-16 px-5 text-xl",
          saved ? "border-success bg-success-soft" : "border-border bg-surface",
        )}
      >
        <span aria-hidden>{saved ? "✅" : "⭐"}</span>
        {compact ? null : saved ? "In My Words" : "Save to My Words"}
      </button>
      {failed ? (
        <p role="status" className="text-lg font-semibold">
          Something went wrong. Let&apos;s try again.
        </p>
      ) : null}
    </div>
  );
}
