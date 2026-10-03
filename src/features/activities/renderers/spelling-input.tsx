"use client";

import { useState } from "react";
import { ChildKeyboard } from "@/components/child/child-keyboard";
import { Button } from "@/components/ui/button";
import type { InputMethod } from "@/lib/learning/rules";
import { cn } from "@/lib/utils";
import { TileBoard } from "./tile-board";

// How a child writes a word, chosen per activity (or by the level's spelling rules):
//   KEYBOARD            the device keyboard (no autocorrect, no capitalisation)
//   ON_SCREEN_KEYBOARD  the child keyboard (big keys, Delete, Check)
//   LETTER_TILES        tap letter tiles into place
//   DRAG_DROP           drag letter tiles into place (tap still works on touch screens)
// Tile input needs tiles; without them it falls back to the on-screen keyboard. Whatever
// the method, the answer is the text the child wrote — never corrected.
export function SpellingInput({
  id,
  method,
  tiles,
  slots,
  locked,
  state,
  onSubmit,
  sentence = false,
}: {
  id: string;
  method: InputMethod;
  tiles?: string[];
  slots: number;
  locked: boolean;
  state: "none" | "right" | "wrong";
  onSubmit: (value: string) => void;
  sentence?: boolean;
}) {
  const [value, setValue] = useState("");
  const useTiles = (method === "LETTER_TILES" || method === "DRAG_DROP") && !!tiles?.length && !sentence;
  const effective: InputMethod = useTiles
    ? method
    : method === "KEYBOARD"
      ? "KEYBOARD"
      : "ON_SCREEN_KEYBOARD";

  if (effective === "LETTER_TILES" || effective === "DRAG_DROP") {
    return (
      <div className="flex w-full flex-col items-center gap-2" data-input-method={effective}>
        {effective === "DRAG_DROP" ? (
          <p className="text-muted text-lg font-semibold">
            <span aria-hidden>👆 </span>Drag or tap the letters.
          </p>
        ) : null}
        <TileBoard
          tiles={tiles!}
          slots={Math.max(1, slots)}
          locked={locked}
          highlightState={state}
          onCheck={(sequence) => onSubmit(sequence.join(""))}
        />
      </div>
    );
  }

  if (effective === "ON_SCREEN_KEYBOARD") {
    return (
      <div className="flex w-full flex-col items-center" data-input-method={effective}>
        <ChildKeyboard
          value={value}
          onChange={setValue}
          onSubmit={() => onSubmit(value)}
          disabled={locked}
          sentence={sentence}
          maxLength={sentence ? 200 : 40}
        />
      </div>
    );
  }

  const field = cn(
    "bg-surface w-full rounded-3xl border-4 px-6 text-center font-extrabold",
    sentence ? "min-h-32 max-w-2xl py-4 text-3xl leading-snug" : "min-h-20 max-w-md text-5xl tracking-widest",
    state === "right"
      ? "border-success bg-success-soft"
      : state === "wrong"
        ? "animate-wiggle border-danger"
        : "border-primary/40",
  );
  return (
    <form
      className="flex w-full flex-col items-center gap-4"
      data-input-method="KEYBOARD"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() && !locked) onSubmit(value);
      }}
    >
      <label htmlFor={id} className="sr-only">
        {sentence ? "Write the sentence" : "Type the word"}
      </label>
      {sentence ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\n/g, " ").slice(0, 200))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (value.trim() && !locked) onSubmit(value);
            }
          }}
          disabled={locked}
          rows={2}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={field}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, 40))}
          disabled={locked}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          enterKeyHint="done"
          className={field}
        />
      )}
      {!locked ? (
        <Button type="submit" variant="success" size="xl" disabled={!value.trim()}>
          <span aria-hidden>✓</span> Check
        </Button>
      ) : null}
    </form>
  );
}
