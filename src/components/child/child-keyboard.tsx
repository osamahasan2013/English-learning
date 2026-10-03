"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// A child-friendly on-screen keyboard: big letter keys in alphabetical order, Delete and
// Check. Every key is a plain button (never a link or a form submit), so a stray tap cannot
// navigate away; Backspace does not go "back" either. A physical keyboard still works
// while it is on screen (letters, Backspace, Enter). In sentence mode it adds Space, a
// capital-letter key and . ? ! keys.

const ROWS = ["abcdefg", "hijklmn", "opqrstu", "vwxyz'"];
const PUNCTUATION = [".", "?", "!", ","];

export function ChildKeyboard({
  value,
  onChange,
  onSubmit,
  disabled = false,
  maxLength = 40,
  sentence = false,
  submitLabel = "Check",
  label = "Your spelling",
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  maxLength?: number;
  sentence?: boolean;
  submitLabel?: string;
  label?: string;
}) {
  const capitalNext = useRef(false);
  const latest = useRef({ value, disabled, onChange, onSubmit });
  useEffect(() => {
    latest.current = { value, disabled, onChange, onSubmit };
  });

  const type = (key: string) => {
    const { value: current, disabled: off, onChange: change } = latest.current;
    if (off || current.length >= maxLength) return;
    const ch = capitalNext.current && /^[a-z]$/.test(key) ? key.toUpperCase() : key;
    capitalNext.current = false;
    change(current + ch);
  };
  const remove = () => {
    const { value: current, disabled: off, onChange: change } = latest.current;
    if (!off) change(current.slice(0, -1));
  };
  const submit = () => {
    const { value: current, disabled: off, onSubmit: send } = latest.current;
    if (!off && current.trim()) send();
  };

  // A physical keyboard types into the on-screen one (no text field, no autocorrect).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (latest.current.disabled || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (/^[a-zA-Z']$/.test(e.key) || (sentence && /^[ .?!,]$/.test(e.key))) {
        e.preventDefault();
        const { value: current, onChange: change } = latest.current;
        if (current.length < maxLength) change(current + (sentence ? e.key : e.key.toLowerCase()));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sentence, maxLength]);

  const key =
    "bg-surface border-border flex min-h-14 min-w-11 flex-1 items-center justify-center rounded-2xl border-2 text-3xl font-extrabold shadow-sm transition select-none enabled:active:scale-95 disabled:opacity-50 sm:min-h-16";

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-4">
      <p
        aria-live="polite"
        aria-label={`${label}: ${value ? [...value].join(" ") : "empty"}`}
        className="bg-surface border-primary/40 flex min-h-20 w-full items-center justify-center rounded-3xl border-4 px-4 text-center text-4xl font-extrabold tracking-widest break-all sm:text-5xl"
      >
        <span aria-hidden>{value || " "}</span>
        {!disabled ? (
          <span aria-hidden className="bg-primary ml-1 inline-block h-10 w-1 animate-pulse rounded" />
        ) : null}
      </p>
      <div role="group" aria-label="Keyboard" className="flex w-full flex-col gap-2">
        {ROWS.map((row) => (
          <div key={row} className="flex w-full gap-1.5 sm:gap-2">
            {[...row].map((letter) => (
              <button
                key={letter}
                type="button"
                className={key}
                disabled={disabled}
                onClick={() => type(letter)}
                aria-label={letter === "'" ? "apostrophe" : letter}
              >
                {letter}
              </button>
            ))}
          </div>
        ))}
        {sentence ? (
          <div className="flex w-full gap-1.5 sm:gap-2">
            <button
              type="button"
              className={cn(key, "text-2xl")}
              disabled={disabled}
              onClick={() => (capitalNext.current = !capitalNext.current)}
              aria-label="Capital letter next"
            >
              Aa
            </button>
            {PUNCTUATION.map((mark) => (
              <button
                key={mark}
                type="button"
                className={key}
                disabled={disabled}
                onClick={() => type(mark)}
                aria-label={
                  mark === "."
                    ? "full stop"
                    : mark === "?"
                      ? "question mark"
                      : mark === "!"
                        ? "exclamation mark"
                        : "comma"
                }
              >
                {mark}
              </button>
            ))}
            <button
              type="button"
              className={cn(key, "flex-[3] text-xl")}
              disabled={disabled}
              onClick={() => type(" ")}
              aria-label="space"
            >
              space
            </button>
          </div>
        ) : null}
        <div className="flex w-full gap-2">
          <button
            type="button"
            className={cn(key, "text-xl")}
            disabled={disabled || value.length === 0}
            onClick={remove}
          >
            <span aria-hidden>⌫</span> Delete
          </button>
          <button
            type="button"
            className={cn(key, "bg-success border-success text-xl text-white")}
            disabled={disabled || !value.trim()}
            onClick={submit}
          >
            <span aria-hidden>✓</span> {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
