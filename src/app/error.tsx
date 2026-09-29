"use client";

import { Button } from "@/components/ui/button";

// Fallback for public pages (landing, auth). Area-specific boundaries in parent/, child/
// and admin/ take precedence there.
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center"
    >
      <p className="text-6xl" aria-hidden>
        🙈
      </p>
      <h1 className="text-2xl font-extrabold">Something went wrong</h1>
      <p className="text-muted">Please try again. If it keeps happening, check your connection.</p>
      {error.digest ? <p className="text-muted text-sm">Reference: {error.digest}</p> : null}
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
