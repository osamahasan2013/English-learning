"use client";

import { useSync } from "@/components/layout/sync-provider";
import { cn } from "@/lib/utils";

// Always-visible connection state. `variant="child"` uses an icon and two words; the
// parent variant also explains that progress is safe and how much is waiting to sync.
export function OfflineIndicator({ variant = "parent" }: { variant?: "parent" | "child" }) {
  const { online, pending, failed } = useSync();
  if (online && pending === 0 && failed === 0) return null;

  if (variant === "child") {
    if (online) return null;
    return (
      <div
        role="status"
        className="bg-warning-soft text-warning flex items-center gap-2 rounded-full px-4 py-2 text-lg font-bold"
      >
        <span aria-hidden>☁️</span> Offline
      </div>
    );
  }

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-2 text-sm font-semibold",
        online ? "bg-accent-soft text-accent" : "bg-warning-soft text-warning",
      )}
    >
      <span>{online ? "Online" : "Offline — learning is saved on this device and will sync later."}</span>
      {pending > 0 ? (
        <span>
          {pending} update{pending === 1 ? "" : "s"} waiting to sync
        </span>
      ) : null}
      {failed > 0 ? <span className="text-danger">{failed} could not sync (see Settings)</span> : null}
    </div>
  );
}
