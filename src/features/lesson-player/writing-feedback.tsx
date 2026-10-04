"use client";

import type { WritingAnalysis } from "@/lib/learning/writing";
import { cn } from "@/lib/utils";

// What the writing checks found, shown after a written answer: each check with a tick or
// "not yet" (icon + words, never colour alone), the must-haves first. It is learning
// feedback, not a grade: no score, no percentage. The checks come from the device's answer
// key (the same checks the server stores); they hold no answer.

export function firstWritingHint(analysis: WritingAnalysis | null | undefined): string | null {
  const failed =
    analysis?.criteria.find((c) => c.critical && c.met === false) ??
    analysis?.criteria.find((c) => c.met === false);
  return failed ? failed.hint || failed.label : null;
}

export function WritingFeedback({ analysis, correct }: { analysis: WritingAnalysis; correct: boolean }) {
  const criteria = [...analysis.criteria].sort((a, b) => Number(b.critical) - Number(a.critical));
  if (criteria.length === 0) return null;
  return (
    <div className="bg-surface text-foreground rounded-3xl p-4" data-testid="writing-feedback">
      <p className="text-lg font-bold">
        <span aria-hidden>📝 </span>
        {correct ? "Your writing:" : "Let's check your writing:"}
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {criteria.map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-lg" data-met={String(c.met)}>
            <span aria-hidden className="w-7 shrink-0 text-center">
              {c.met === true ? "✅" : c.met === false ? (c.critical ? "🔸" : "💡") : "➖"}
            </span>
            <span className={cn("font-semibold", c.met === false && c.critical && "font-extrabold")}>
              {c.label}
              <span className="sr-only">
                {c.met === true ? " — done" : c.met === false ? " — not yet" : " — not checked"}
              </span>
              {c.met === false && c.hint ? (
                <span className="text-muted block text-base font-semibold">{c.hint}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
