import { getLearningDb, type OutboxItem } from "@/lib/offline/db";
import { MAX_EVENTS_PER_REQUEST, type SyncEvent, type SyncResponse } from "@/lib/offline/sync-protocol";

// Offline-first progress: every learning event goes into the outbox first, then
// flushOutbox() sends pending events in order and removes only what the server confirmed.
//
// Nothing is ever silently discarded:
//   * network error / 5xx / 429  → stays pending, retried later
//   * 401                        → stays pending until the parent signs in again
//   * server "rejected" an event → marked failed, kept, counted in the UI
//   * 400/403 for the batch      → every event in it marked failed with the reason

export async function enqueue(childId: string, event: SyncEvent) {
  await getLearningDb().outbox.put({
    id: event.id,
    childId,
    event,
    status: "pending",
    createdAt: Date.now(),
    tries: 0,
  });
}

export async function pendingCount(childId?: string) {
  const db = getLearningDb();
  return childId
    ? db.outbox.where({ childId, status: "pending" }).count()
    : db.outbox.where("status").equals("pending").count();
}

export async function failedItems() {
  return getLearningDb().outbox.where("status").equals("failed").toArray();
}

export type FlushResult =
  | { state: "done"; sent: number; failed: number }
  | { state: "offline" | "unauthenticated" | "retry_later"; sent: number; failed: number };

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

let flushing: Promise<FlushResult> | null = null;

// Serialised: concurrent callers share one in-flight flush.
export function flushOutbox(fetcher: Fetcher = (i, init) => fetch(i, init)): Promise<FlushResult> {
  flushing ??= doFlush(fetcher).finally(() => {
    flushing = null;
  });
  return flushing;
}

async function doFlush(fetcher: Fetcher): Promise<FlushResult> {
  const db = getLearningDb();
  let sent = 0;
  let failed = 0;
  const onAchievements: SyncResponse["newAchievements"] = [];

  // Bounded, so a server that keeps omitting a result can never spin this loop forever.
  for (let round = 0; round < 50; round++) {
    const pending = await db.outbox.where("status").equals("pending").sortBy("createdAt");
    if (pending.length === 0) break;
    // One child per request, oldest first, so an attempt always reaches the server before
    // the lesson run that is scored from it.
    const childId = pending[0].childId;
    const batch = pending.filter((p) => p.childId === childId).slice(0, MAX_EVENTS_PER_REQUEST);

    let response: Response;
    try {
      response = await fetcher("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ childId, events: batch.map((b) => b.event) }),
        credentials: "same-origin",
      });
    } catch {
      await bumpTries(batch, "network_error");
      return { state: "offline", sent, failed };
    }

    if (response.status === 401) return { state: "unauthenticated", sent, failed };
    if (response.status === 429 || response.status >= 500) {
      await bumpTries(batch, `http_${response.status}`);
      return { state: "retry_later", sent, failed };
    }
    if (!response.ok) {
      const reason = await response
        .json()
        .then((b: { error?: string }) => b.error ?? `http_${response.status}`)
        .catch(() => `http_${response.status}`);
      await markFailed(batch, reason);
      failed += batch.length;
      continue;
    }

    const body = (await response.json()) as SyncResponse;
    const byId = new Map(body.results.map((r) => [r.id, r]));
    await db.transaction("rw", db.outbox, async () => {
      for (const item of batch) {
        const result = byId.get(item.id);
        if (!result) {
          await db.outbox.update(item.id, { tries: item.tries + 1, lastError: "missing_result" });
        } else if (result.status === "rejected") {
          await db.outbox.update(item.id, { status: "failed", lastError: result.reason ?? "rejected" });
          failed += 1;
        } else {
          await db.outbox.delete(item.id);
          sent += 1;
        }
      }
    });
    onAchievements.push(...body.newAchievements);
    if (batch.every((item) => !byId.has(item.id))) {
      return { state: "retry_later", sent, failed };
    }
  }
  if (onAchievements.length > 0 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("learning:achievements", { detail: onAchievements }));
  }
  return { state: "done", sent, failed };
}

async function bumpTries(batch: OutboxItem[], reason: string) {
  const db = getLearningDb();
  await db.transaction("rw", db.outbox, async () => {
    for (const item of batch) await db.outbox.update(item.id, { tries: item.tries + 1, lastError: reason });
  });
}

async function markFailed(batch: OutboxItem[], reason: string) {
  const db = getLearningDb();
  await db.transaction("rw", db.outbox, async () => {
    for (const item of batch) await db.outbox.update(item.id, { status: "failed", lastError: reason });
  });
}

// Lets a parent retry events that failed (e.g. after a server-side fix).
export async function retryFailed() {
  const db = getLearningDb();
  const failed = await db.outbox.where("status").equals("failed").toArray();
  await db.transaction("rw", db.outbox, async () => {
    for (const item of failed) await db.outbox.update(item.id, { status: "pending" });
  });
  return failed.length;
}

// Records one learning event: outbox first; if IndexedDB is unavailable on this device,
// sends it straight to the server so the answer still counts when online.
export async function recordEvent(
  childId: string,
  event: SyncEvent,
  fetcher: Fetcher = (i, init) => fetch(i, init),
) {
  try {
    await enqueue(childId, event);
    return "queued" as const;
  } catch {
    try {
      const response = await fetcher("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ childId, events: [event] }),
        credentials: "same-origin",
      });
      return response.ok ? ("sent" as const) : ("lost" as const);
    } catch {
      return "lost" as const;
    }
  }
}
