"use client";

import { useId } from "react";
import type { SpeakFn } from "@/lib/audio/audio-service";
import type { LessonStep } from "@/lib/learning/lesson-payload";
import { analyzeMechanics, spacingMet, writtenWords } from "@/lib/learning/writing";
import { cn } from "@/lib/utils";

// Shared pieces of the typed-writing renderers: a big writing box, a word bank to tap
// (hear the word, add it), and the "writing checklist" — reminders of what the level asks
// for (capital letter, spaces, end mark), ticked as the child writes. The checklist only
// reads the child's own text; whether the answer is right is decided by the answer key and
// again on the server.

export type FieldState = "none" | "right" | "wrong";

export function fieldState(phase: string): FieldState {
  return phase === "correct" ? "right" : phase === "retry" || phase === "reveal" ? "wrong" : "none";
}

export function WritingField({
  id,
  label,
  value,
  onChange,
  locked,
  state,
  multiline = false,
  placeholder,
  maxLength = 600,
  onFocus,
  big = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  locked: boolean;
  state: FieldState;
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
  onFocus?: () => void;
  big?: boolean;
}) {
  const className = cn(
    "bg-surface w-full rounded-3xl border-4 px-5 py-3 font-bold leading-snug",
    big ? "text-3xl" : "text-2xl",
    state === "right"
      ? "border-success bg-success-soft"
      : state === "wrong"
        ? "border-danger"
        : "border-primary/40",
  );
  const common = {
    id,
    value,
    disabled: locked,
    placeholder,
    autoComplete: "off",
    autoCorrect: "off",
    // Capitals are part of what is learned: the keyboard does not add them.
    autoCapitalize: "none",
    spellCheck: false,
    onFocus,
    "aria-label": label,
  } as const;
  return multiline ? (
    <textarea
      {...common}
      rows={3}
      className={cn(className, "min-h-28 resize-y")}
      onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
    />
  ) : (
    <input
      {...common}
      className={cn(className, "min-h-16")}
      onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
    />
  );
}

export function WordBank({
  words,
  locked,
  speak,
  onPick,
}: {
  words: string[];
  locked: boolean;
  speak: SpeakFn;
  onPick: (word: string) => void;
}) {
  if (words.length === 0) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-muted text-lg font-semibold">
        <span aria-hidden>📚 </span>Word bank
      </p>
      <div className="flex max-w-2xl flex-wrap justify-center gap-2" role="group" aria-label="Word bank">
        {words.map((word) => (
          <button
            key={word}
            type="button"
            disabled={locked}
            onClick={() => {
              void speak(word);
              onPick(word);
            }}
            className="border-border bg-surface min-h-14 rounded-2xl border-4 px-4 text-2xl font-bold shadow-sm enabled:active:scale-95"
          >
            {word}
          </button>
        ))}
      </div>
    </div>
  );
}

// Adds a word to a box with a space before it when needed.
export function appendWord(text: string, word: string) {
  const t = text.replace(/\s+$/, "");
  return t ? `${t} ${word}` : word;
}

// Reminders of the level's mechanics (and any extra checklist lines of the question), with
// a tick when the child's text already does it. Icons and words; never colour alone.
export function WritingChecklist({
  step,
  units,
  extra = [],
}: {
  step: LessonStep;
  units: string[];
  extra?: string[];
}) {
  const id = useId();
  const settings = step.writing;
  if (step.activityConfig.checklist === false || !settings) return null;
  const filled = units.filter((u) => writtenWords(u).length > 0);
  const report = filled.length > 0 ? analyzeMechanics(filled) : null;
  const items: { key: string; icon: string; text: string; done: boolean | null }[] = [];
  if (settings.mechanics.capitalization !== "off")
    items.push({
      key: "cap",
      icon: "🔠",
      text: "Capital letter at the start",
      done: report ? report.capitalization.ok : null,
    });
  if (settings.mechanics.spacing !== "off")
    items.push({
      key: "space",
      icon: "␣",
      text: "Spaces between words",
      done: report ? spacingMet(report) : null,
    });
  if (settings.mechanics.punctuation !== "off")
    items.push({
      key: "end",
      icon: "⏺",
      text: "End mark . ! ?",
      done: report ? report.punctuation.ok : null,
    });
  for (const [i, text] of extra.entries()) items.push({ key: `x${i}`, icon: "☐", text, done: null });
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={id} className="bg-surface-muted w-full max-w-2xl rounded-3xl px-5 py-3">
      <h3 id={id} className="text-lg font-bold">
        <span aria-hidden>📝 </span>My writing checklist
      </h3>
      <ul className="mt-1 grid gap-1 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-2 text-lg font-semibold">
            <span aria-hidden className="w-7 text-center">
              {item.done ? "✅" : item.icon}
            </span>
            <span>{item.text}</span>
            {item.done ? <span className="sr-only">(done)</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
