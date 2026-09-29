import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LearningDatabase, setLearningDbForTests } from "@/lib/offline/db";
import { enqueue, failedItems, flushOutbox, pendingCount, retryFailed } from "@/lib/offline/outbox";
import type { SyncEvent } from "@/lib/offline/sync-protocol";

const CHILD = "11111111-1111-4111-8111-111111111111";
let db: LearningDatabase;
let n = 0;

function attempt(id: string): SyncEvent {
  return {
    kind: "attempt",
    id,
    questionId: "22222222-2222-4222-8222-222222222222",
    lessonRunId: null,
    attemptNumber: 1,
    response: { value: "cat" },
    responseTimeMs: 1200,
    attemptedAt: "2026-09-29T08:00:00.000Z",
  };
}
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

function respond(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

beforeEach(() => {
  db = new LearningDatabase(`test-${n++}`);
  setLearningDbForTests(db);
});
afterEach(async () => {
  await db.delete();
  setLearningDbForTests(null);
});

describe("outbox", () => {
  it("removes events the server stored or already had", async () => {
    await enqueue(CHILD, attempt(uuid(1)));
    await enqueue(CHILD, attempt(uuid(2)));
    const fetcher = respond(200, {
      results: [
        { id: uuid(1), status: "stored" },
        { id: uuid(2), status: "duplicate" },
      ],
      newAchievements: [],
    });
    expect(await flushOutbox(fetcher)).toEqual({ state: "done", sent: 2, failed: 0 });
    expect(await pendingCount()).toBe(0);
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.events.map((e: SyncEvent) => e.id)).toEqual([uuid(1), uuid(2)]);
  });

  it("keeps everything when offline", async () => {
    await enqueue(CHILD, attempt(uuid(1)));
    const fetcher = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect((await flushOutbox(fetcher)).state).toBe("offline");
    expect(await pendingCount(CHILD)).toBe(1);
    expect((await db.outbox.get(uuid(1)))?.tries).toBe(1);
  });

  it("keeps events pending on server errors and when signed out", async () => {
    await enqueue(CHILD, attempt(uuid(1)));
    expect((await flushOutbox(respond(503, {}))).state).toBe("retry_later");
    expect((await flushOutbox(respond(401, {}))).state).toBe("unauthenticated");
    expect(await pendingCount()).toBe(1);
  });

  it("never discards rejected events: they are kept as failed and can be retried", async () => {
    await enqueue(CHILD, attempt(uuid(1)));
    const result = await flushOutbox(
      respond(200, {
        results: [{ id: uuid(1), status: "rejected", reason: "unknown_question" }],
        newAchievements: [],
      }),
    );
    expect(result).toEqual({ state: "done", sent: 0, failed: 1 });
    expect((await failedItems()).map((f) => [f.id, f.lastError])).toEqual([[uuid(1), "unknown_question"]]);
    expect(await retryFailed()).toBe(1);
    expect(await pendingCount()).toBe(1);
  });

  it("marks a batch failed when the server refuses it (e.g. child removed)", async () => {
    await enqueue(CHILD, attempt(uuid(1)));
    await flushOutbox(respond(403, { error: "child_not_found" }));
    expect((await failedItems())[0].lastError).toBe("child_not_found");
  });

  it("does not duplicate an event enqueued twice", async () => {
    await enqueue(CHILD, attempt(uuid(1)));
    await enqueue(CHILD, attempt(uuid(1)));
    expect(await pendingCount()).toBe(1);
  });
});
