"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Admin-facing error with diagnostics (message and server digest for log lookup).
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card className="space-y-3">
      <h1 className="text-xl font-bold">This page could not be loaded</h1>
      <p className="text-muted text-sm">
        Details: {error.message || "Unknown error"}
        {error.digest ? ` (server log reference ${error.digest})` : ""}
      </p>
      <Button onClick={reset}>Try again</Button>
    </Card>
  );
}
