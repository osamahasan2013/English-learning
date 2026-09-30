"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// Keeps young children inside the child area: leaving asks a sum most 3–8 year olds can't
// yet answer. A usability barrier, not a security boundary (the device is already signed
// in as the parent).
function makeQuestion() {
  const a = 6 + Math.floor(Math.random() * 7);
  const b = 4 + Math.floor(Math.random() * 6);
  return { a, b, answer: a * b };
}

export function ParentGate({ action }: { action: () => Promise<void> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // A fixed first value keeps server and client renders identical; a random sum is drawn
  // each time the gate opens.
  const [question, setQuestion] = useState({ a: 7, b: 8, answer: 56 });
  const [value, setValue] = useState("");
  const [wrong, setWrong] = useState(false);

  function open() {
    setQuestion(makeQuestion());
    setValue("");
    setWrong(false);
    dialogRef.current?.showModal();
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="bg-surface text-muted flex min-h-12 items-center gap-2 rounded-full px-4 font-bold shadow-sm"
        aria-label="Grown-ups: leave the child area"
      >
        <span aria-hidden>🔒</span> Grown-ups
      </button>
      <dialog
        ref={dialogRef}
        className="m-auto w-[min(92vw,26rem)] rounded-3xl p-6 backdrop:bg-black/50"
        aria-labelledby="gate-title"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (Number(value) === question.answer) {
              void action();
            } else {
              setWrong(true);
              setQuestion(makeQuestion());
              setValue("");
            }
          }}
        >
          <h2 id="gate-title" className="text-xl font-bold">
            For grown-ups
          </h2>
          <label htmlFor="gate-answer" className="block text-lg">
            What is {question.a} × {question.b}?
          </label>
          <input
            id="gate-answer"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 3))}
            className="border-border min-h-12 w-full rounded-xl border-2 px-3 text-xl"
          />
          {wrong ? (
            <p role="alert" className="text-danger font-semibold">
              That&apos;s not right. Try this one.
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit">Continue</Button>
            <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
