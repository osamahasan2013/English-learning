"use client";

import { Button } from "@/components/ui/button";

// Child-facing errors never show technical details.
export default function ChildError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <span className="text-8xl" aria-hidden>
        🙈
      </span>
      <p className="text-3xl font-extrabold">Something went wrong. Let&apos;s try again.</p>
      <Button size="xl" onClick={reset}>
        🔄 Try again
      </Button>
    </div>
  );
}
