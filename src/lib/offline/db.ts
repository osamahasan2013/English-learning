import Dexie, { type EntityTable } from "dexie";
import type { LessonPayload } from "@/lib/learning/lesson-payload";
import type { SessionState } from "@/lib/learning/lesson-session";
import type { SyncEvent } from "@/lib/offline/sync-protocol";

// The device-side database (IndexedDB via Dexie).
//   outbox  — learning events not yet confirmed by the server. Written BEFORE anything is
//             sent, so progress survives going offline, closing the tab or a crash.
//   lessons — lesson payloads the child has opened, for offline replay.
//   runs    — the lesson a child is in the middle of (player state), so closing the tab
//             or losing power never loses their place.

export type OutboxStatus = "pending" | "failed";

export type OutboxItem = {
  id: string; // = the event id; the server de-duplicates on it
  childId: string;
  event: SyncEvent;
  status: OutboxStatus;
  createdAt: number;
  tries: number;
  lastError?: string;
};

export type CachedLesson = {
  lessonId: string;
  payload: LessonPayload;
  cachedAt: number;
};

export type SavedRun = {
  key: string; // `${childId}:${lessonId}`
  runId: string;
  startedAt: string;
  preview: boolean;
  state: SessionState;
  updatedAt: number;
};

export class LearningDatabase extends Dexie {
  outbox!: EntityTable<OutboxItem, "id">;
  lessons!: EntityTable<CachedLesson, "lessonId">;
  runs!: EntityTable<SavedRun, "key">;

  constructor(name = "english-learning") {
    super(name);
    this.version(1).stores({
      outbox: "id, [childId+status], status, createdAt",
      lessons: "lessonId, cachedAt",
    });
    this.version(2).stores({ runs: "key, updatedAt" });
  }
}

let instance: LearningDatabase | null = null;

export function getLearningDb() {
  instance ??= new LearningDatabase();
  return instance;
}

// Tests use a fresh database per case.
export function setLearningDbForTests(db: LearningDatabase | null) {
  instance = db;
}
