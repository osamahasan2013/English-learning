"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

// A confirmation step for actions that can't be undone, on the native <dialog> the app
// already uses for the grown-up gate: modal, Escape cancels (except while working), focus
// moves into the dialog and back to the button afterwards. With `typeToConfirm`, the
// confirm button stays disabled until that text is typed (any case, extra spaces ignored).
// `onConfirm` returns an error message to show, or null when it succeeded.
export function ConfirmDialog({
  triggerLabel,
  triggerVariant = "secondary",
  title,
  children,
  confirmLabel,
  pendingLabel,
  confirmVariant = "danger",
  typeToConfirm,
  onConfirm,
}: {
  triggerLabel: string;
  triggerVariant?: ButtonProps["variant"];
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  confirmVariant?: ButtonProps["variant"];
  typeToConfirm?: string;
  onConfirm: () => Promise<string | null>;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches =
    !typeToConfirm || typed.trim().toLocaleLowerCase() === typeToConfirm.trim().toLocaleLowerCase();

  function open() {
    setTyped("");
    setError(null);
    dialogRef.current?.showModal();
    // The safe choice gets focus: the name field, or Cancel.
    (typeToConfirm ? inputRef.current : cancelRef.current)?.focus();
  }

  async function confirm() {
    if (!matches || pending) return;
    setPending(true);
    setError(null);
    try {
      const message = await onConfirm();
      if (message) setError(message);
      else dialogRef.current?.close();
    } catch {
      setError("Something went wrong. Nothing was changed. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant={triggerVariant} onClick={open}>
        {triggerLabel}
      </Button>
      <dialog
        ref={dialogRef}
        className="m-auto w-[min(92vw,30rem)] rounded-3xl p-6 backdrop:bg-black/50"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        onCancel={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <h2 id={`${id}-title`} className="text-xl font-bold">
            {title}
          </h2>
          <div id={`${id}-desc`} className="space-y-2">
            {children}
          </div>
          {typeToConfirm ? (
            <label className="block space-y-1">
              <span className="font-semibold">Type {typeToConfirm} to confirm</span>
              <input
                ref={inputRef}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="border-border min-h-12 w-full rounded-xl border-2 px-3 text-lg"
              />
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-danger font-semibold">
              <span aria-hidden>⚠️ </span>
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              ref={cancelRef}
              variant="secondary"
              disabled={pending}
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
            </Button>
            <Button type="submit" variant={confirmVariant} disabled={!matches || pending}>
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
