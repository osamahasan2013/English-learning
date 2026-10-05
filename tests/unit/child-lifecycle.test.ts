import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isObsoleteEvent } from "@/lib/learning/learning-reset";
import { clearChildLocalData } from "@/lib/offline/child-data";
import { LearningDatabase, setLearningDbForTests } from "@/lib/offline/db";
import { enqueue, flushOutbox, pendingCount } from "@/lib/offline/outbox";
import { currentSessionId } from "@/lib/offline/session-store";
import { syncEventSchema, type SyncEvent } from "@/lib/offline/sync-protocol";

// Phase 8.4 (ADR-046): after a child is deleted or their learning is reset, nothing
// recorded before can come back — not from this device (its data for the child is
// cleared) and not from another device that was offline (the server refuses the events).

const CHILD_A = "11111111-1111-4111-8111-111111111111";
const CHILD_B = "33333333-3333-4333-8333-333333333333";
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

function attempt(id: string, opts: { epoch?: number; at?: string } = {}): SyncEvent {
  return {
    kind: "attempt",
    id,
    ...(opts.epoch !== undefined ? { epoch: opts.epoch } : {}),
    questionId: "22222222-2222-4222-8222-222222222222",
    lessonRunId: null,
    attemptNumber: 1,
    response: { value: "cat" },
    responseTimeMs: 1200,
    attemptedAt: opts.at ?? "2026-10-05T08:00:00.000Z",
  };
}

describe("events from before a learning reset are obsolete", () => {
  const reset = { learningEpoch: 2, learningResetAt: "2026-10-05T10:00:00.000Z" };

  it("an event that carries its epoch is obsolete only when the epoch is older", () => {
    expect(isObsoleteEvent(attempt(uuid(1), { epoch: 1 }), reset)).toBe(true);
    expect(isObsoleteEvent(attempt(uuid(2), { epoch: 2 }), reset)).toBe(false);
    // The epoch decides even when the device clock is wrong (here: before the reset).
    expect(isObsoleteEvent(attempt(uuid(3), { epoch: 2, at: "2026-10-01T00:00:00.000Z" }), reset)).toBe(
      false,
    );
    expect(isObsoleteEvent(attempt(uuid(4), { epoch: 1, at: "2026-10-09T00:00:00.000Z" }), reset)).toBe(true);
  });

  it("an event from an older app version (no epoch) is compared by when it happened", () => {
    expect(isObsoleteEvent(attempt(uuid(5), { at: "2026-10-05T09:59:59.000Z" }), reset)).toBe(true);
    expect(isObsoleteEvent(attempt(uuid(6), { at: "2026-10-05T10:00:01.000Z" }), reset)).toBe(false);
    // A run started before the reset belongs to the old journey even if it ended after.
    const run: SyncEvent = {
      kind: "lesson_run",
      id: uuid(7),
      lessonId: uuid(8),
      startedAt: "2026-10-05T09:55:00.000Z",
      completedAt: "2026-10-05T10:05:00.000Z",
    };
    expect(isObsoleteEvent(run, reset)).toBe(true);
  });

  it("a child whose learning was never reset accepts everything", () => {
    const fresh = { learningEpoch: 0, learningResetAt: null };
    expect(isObsoleteEvent(attempt(uuid(9)), fresh)).toBe(false);
    expect(isObsoleteEvent(attempt(uuid(10), { epoch: 0 }), fresh)).toBe(false);
  });

  it("the sync protocol accepts the epoch, and events queued before it existed", () => {
    expect(syncEventSchema.safeParse(attempt(uuid(11), { epoch: 3 })).success).toBe(true);
    expect(syncEventSchema.safeParse(attempt(uuid(12))).success).toBe(true);
    expect(syncEventSchema.safeParse({ ...attempt(uuid(13)), epoch: -1 }).success).toBe(false);
  });
});

describe("this device's data for a deleted or reset child", () => {
  let db: LearningDatabase;
  let n = 0;
  beforeEach(() => {
    db = new LearningDatabase(`lifecycle-${n++}`);
    setLearningDbForTests(db);
    localStorage.clear();
  });
  afterEach(async () => {
    await db.delete();
    setLearningDbForTests(null);
  });

  async function seed() {
    await enqueue(CHILD_A, attempt(uuid(1)));
    await enqueue(CHILD_A, attempt(uuid(2)));
    await enqueue(CHILD_B, attempt(uuid(3)));
    await db.runs.bulkPut([
      {
        key: `${CHILD_A}:lesson-1`,
        runId: uuid(4),
        startedAt: "",
        preview: false,
        state: {} as never,
        updatedAt: 1,
      },
      {
        key: `${CHILD_B}:lesson-1`,
        runId: uuid(5),
        startedAt: "",
        preview: false,
        state: {} as never,
        updatedAt: 1,
      },
    ]);
    await db.lessons.put({ lessonId: "lesson-1", payload: {} as never, cachedAt: 1 });
    currentSessionId(CHILD_A, 30);
    currentSessionId(CHILD_B, 30);
  }

  it("clearing removes the child's queued events, lessons in progress and session — nothing else", async () => {
    await seed();
    await clearChildLocalData(CHILD_A);
    expect(await pendingCount(CHILD_A)).toBe(0);
    expect(await pendingCount(CHILD_B)).toBe(1);
    expect((await db.runs.toArray()).map((r) => r.key)).toEqual([`${CHILD_B}:lesson-1`]);
    // Lesson content is shared by every child on the device.
    expect(await db.lessons.count()).toBe(1);
    expect(localStorage.getItem(`el_session_${CHILD_A}`)).toBeNull();
    expect(localStorage.getItem(`el_session_${CHILD_B}`)).not.toBeNull();
  });

  it("a deleted child's queued events are dropped when the server answers 410 — never kept to retry", async () => {
    await seed();
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      const { childId, events } = JSON.parse(init.body as string) as { childId: string; events: SyncEvent[] };
      if (childId === CHILD_A)
        return new Response(JSON.stringify({ error: "child_deleted" }), { status: 410 });
      return new Response(
        JSON.stringify({ results: events.map((e) => ({ id: e.id, status: "stored" })), newAchievements: [] }),
        { status: 200 },
      );
    });
    const result = await flushOutbox(fetcher);
    expect(result.state).toBe("done");
    expect(await db.outbox.count()).toBe(0);
    expect((await db.runs.toArray()).map((r) => r.key)).toEqual([`${CHILD_B}:lesson-1`]);
  });

  it("events the server calls obsolete (from before a reset) are dropped, not marked failed", async () => {
    await enqueue(CHILD_A, attempt(uuid(1), { epoch: 0 }));
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [{ id: uuid(1), status: "obsolete", reason: "learning_reset" }],
            newAchievements: [],
          }),
          { status: 200 },
        ),
    );
    expect(await flushOutbox(fetcher)).toMatchObject({ state: "done", failed: 0 });
    expect(await db.outbox.count()).toBe(0);
  });

  it("another family's child (403) is still kept: those events may belong to someone else", async () => {
    await enqueue(CHILD_A, attempt(uuid(1)));
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ error: "child_not_found" }), { status: 403 }),
    );
    await flushOutbox(fetcher);
    expect(await db.outbox.get(uuid(1))).toMatchObject({ status: "failed", lastError: "child_not_found" });
  });
});
