import Dexie, { type EntityTable } from "dexie";
import type { LessonPayload } from "@/lib/learning/lesson-payload";
import type { SyncEvent } from "@/lib/offline/sync-protocol";

// The device-side database (IndexedDB via Dexie).
//   outbox  — learning events not yet confirmed by the server. Written BEFORE anything is
//             sent, so progress survives going offline, closing the tab or a crash.
//   lessons — lesson payloads the child has opened, for offline replay.

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

export class LearningDatabase extends Dexie {
  outbox!: EntityTable<OutboxItem, "id">;
  lessons!: EntityTable<CachedLesson, "lessonId">;

  constructor(name = "english-learning") {
    super(name);
    this.version(1).stores({
      outbox: "id, [childId+status], status, createdAt",
      lessons: "lessonId, cachedAt",
    });
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
