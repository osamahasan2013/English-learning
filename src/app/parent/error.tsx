"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Parent-facing error: explains what happened and shows the diagnostic reference.
export default function ParentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card className="space-y-3">
      <h1 className="text-xl font-bold">This page could not be loaded</h1>
      <p className="text-muted">
        Check your connection and try again. Learning progress already saved on this device is not affected
        and will sync when the page works again.
      </p>
      <p className="text-muted text-sm">
        Details: {error.message || "Unknown error"}
        {error.digest ? ` (reference ${error.digest})` : ""}
      </p>
      <Button onClick={reset}>Try again</Button>
    </Card>
  );
}
