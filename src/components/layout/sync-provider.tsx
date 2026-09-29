"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { failedItems, flushOutbox, pendingCount, retryFailed, type FlushResult } from "@/lib/offline/outbox";

// Keeps the device outbox flowing to the server: on load, when the connection returns,
// when the app comes back to the foreground, after each lesson, and periodically while
// anything is pending. Exposes counts for the offline indicator and parent settings.

type SyncState = {
  online: boolean;
  pending: number;
  failed: number;
  lastResult: FlushResult["state"] | null;
  syncNow: () => Promise<void>;
  retryFailedEvents: () => Promise<void>;
};

const SyncContext = createContext<SyncState | null>(null);
const RETRY_INTERVAL_MS = 30_000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [lastResult, setLastResult] = useState<FlushResult["state"] | null>(null);

  const refreshCounts = useCallback(async () => {
    try {
      setPending(await pendingCount());
      setFailed((await failedItems()).length);
    } catch {
      // IndexedDB unavailable (private mode in some browsers): nothing is queued.
    }
  }, []);

  const syncNow = useCallback(async () => {
    try {
      const result = await flushOutbox();
      setLastResult(result.state);
    } catch {
      setLastResult("retry_later");
    }
    await refreshCounts();
  }, [refreshCounts]);

  const retryFailedEvents = useCallback(async () => {
    await retryFailed();
    await syncNow();
  }, [syncNow]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigator.onLine is only known after mount
    setOnline(navigator.onLine);
    void syncNow();
    const onOnline = () => {
      setOnline(true);
      void syncNow();
    };
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    const onQueued = () => void syncNow();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("learning:queued", onQueued);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("learning:queued", onQueued);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [syncNow]);

  useEffect(() => {
    if (pending === 0) return;
    const timer = setInterval(() => void syncNow(), RETRY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pending, syncNow]);

  const value = useMemo(
    () => ({ online, pending, failed, lastResult, syncNow, retryFailedEvents }),
    [online, pending, failed, lastResult, syncNow, retryFailedEvents],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  const context = useContext(SyncContext);
  if (!context) throw new Error("useSync must be used inside <SyncProvider>");
  return context;
}

// Called after writing to the outbox so the provider sends it right away.
export function notifyQueued() {
  window.dispatchEvent(new Event("learning:queued"));
}
