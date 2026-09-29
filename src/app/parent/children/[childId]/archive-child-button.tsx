"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

export function ArchiveChildButton({ action, name }: { action: () => Promise<void>; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  if (!confirming) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Remove {name}…
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm removal">
      <span className="font-semibold">Remove {name}?</span>
      <Button variant="danger" disabled={pending} onClick={() => startTransition(() => action())}>
        {pending ? "Removing…" : "Yes, remove"}
      </Button>
      <Button variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}
