"use client";

import { useSync } from "@/components/layout/sync-provider";
import { Button } from "@/components/ui/button";

export function SyncStatusPanel() {
  const { online, pending, failed, lastResult, syncNow, retryFailedEvents } = useSync();
  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        <li>
          <span className="font-semibold">Connection:</span> {online ? "online" : "offline"}
        </li>
        <li>
          <span className="font-semibold">Waiting to sync:</span> {pending}
        </li>
        <li>
          <span className="font-semibold">Could not sync:</span> {failed}
        </li>
        {lastResult ? (
          <li>
            <span className="font-semibold">Last attempt:</span> {lastResult.replace("_", " ")}
          </li>
        ) : null}
      </ul>
      <p className="text-muted text-sm">
        Answers are saved on this device first and sent to your account when there is a connection. Nothing is
        deleted from this device until the server confirms it.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void syncNow()}>Sync now</Button>
        {failed > 0 ? (
          <Button variant="secondary" onClick={() => void retryFailedEvents()}>
            Retry {failed} failed
          </Button>
        ) : null}
      </div>
    </div>
  );
}
