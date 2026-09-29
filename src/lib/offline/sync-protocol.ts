import { z } from "zod";
import { responseSchema } from "@/lib/content/question-schemas";

// The device → server progress protocol. Every event carries an id generated on the
// device; the server stores each id at most once, so an event can be retried any number
// of times (offline, flaky network, app restart) without duplicating progress.
// Correctness, scores and stars are never sent: the server derives them.

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });

export const attemptEventSchema = z.object({
  kind: z.literal("attempt"),
  id: uuid,
  questionId: uuid,
  lessonRunId: uuid.nullable(),
  attemptNumber: z.number().int().min(1).max(5),
  response: responseSchema,
  responseTimeMs: z.number().int().min(0).max(3_600_000),
  attemptedAt: timestamp,
});

export const lessonRunEventSchema = z.object({
  kind: z.literal("lesson_run"),
  id: uuid,
  lessonId: uuid,
  startedAt: timestamp,
  completedAt: timestamp,
});

export const syncEventSchema = z.discriminatedUnion("kind", [attemptEventSchema, lessonRunEventSchema]);
export type SyncEvent = z.infer<typeof syncEventSchema>;
export type AttemptEvent = z.infer<typeof attemptEventSchema>;
export type LessonRunEvent = z.infer<typeof lessonRunEventSchema>;

export const MAX_EVENTS_PER_REQUEST = 200;

export const syncRequestSchema = z.object({
  childId: uuid,
  events: z.array(syncEventSchema).min(1).max(MAX_EVENTS_PER_REQUEST),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

// stored = written now; duplicate = already stored earlier (safe to drop locally);
// rejected = will never be accepted (kept on the device and shown to the parent).
export type SyncResult = { id: string; status: "stored" | "duplicate" | "rejected"; reason?: string };

export type SyncResponse = {
  results: SyncResult[];
  newAchievements: { code: string; title: string; emoji: string }[];
};
