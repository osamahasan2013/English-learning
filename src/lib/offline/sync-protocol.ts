import { z } from "zod";
import { responseSchema } from "@/lib/content/question-schemas";

// The device → server progress protocol. Every event carries an id generated on the
// device; the server stores each id at most once, so an event can be retried any number
// of times (offline, flaky network, app restart) without duplicating progress.
// Correctness, scores and stars are never sent: the server derives them.

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
// The child's learning epoch when the event was recorded (Phase 8.4): a reset moves the
// epoch on, and the server treats events from an earlier epoch as obsolete. Optional so
// events queued by an older app version still sync (they are compared by time instead).
const epoch = z.number().int().min(0).max(1_000_000).optional();

export const attemptEventSchema = z.object({
  kind: z.literal("attempt"),
  id: uuid,
  epoch,
  questionId: uuid,
  lessonRunId: uuid.nullable(),
  // Answers given in an assessment (e.g. the Phonics Check) name the assessment and the
  // device-generated id of this sitting instead of a lesson run.
  assessmentId: uuid.nullable().optional(),
  assessmentAttemptId: uuid.nullable().optional(),
  // The learning session on this device (src/lib/learning/learning-session.ts). Optional
  // so events queued by an older app version still sync.
  sessionId: uuid.nullable().optional(),
  attemptNumber: z.number().int().min(1).max(5),
  response: responseSchema,
  // Hints opened before answering (spelling). Optional so older queued events still sync.
  hintsUsed: z.number().int().min(0).max(5).optional(),
  responseTimeMs: z.number().int().min(0).max(3_600_000),
  attemptedAt: timestamp,
});

export const lessonRunEventSchema = z.object({
  kind: z.literal("lesson_run"),
  id: uuid,
  epoch,
  lessonId: uuid,
  sessionId: uuid.nullable().optional(),
  startedAt: timestamp,
  completedAt: timestamp,
});

// A finished assessment sitting; `id` is the assessmentAttemptId its answers carry.
export const assessmentRunEventSchema = z.object({
  kind: z.literal("assessment_run"),
  id: uuid,
  epoch,
  assessmentId: uuid,
  sessionId: uuid.nullable().optional(),
  startedAt: timestamp,
  completedAt: timestamp,
});

// Reading a text (a story) once: never scored. The server keeps only the help words that
// belong to the story, takes the word count from the story, and stores the session once.
export const readingEventSchema = z.object({
  kind: z.literal("reading"),
  id: uuid,
  epoch,
  storyId: uuid,
  lessonId: uuid.nullable(),
  lessonRunId: uuid.nullable(),
  questionId: uuid.nullable(),
  sessionId: uuid.nullable().optional(),
  mode: z.enum(["listen_first", "read_first", "reread"]),
  startedAt: timestamp,
  durationMs: z.number().int().min(0).max(3_600_000),
  listens: z.number().int().min(0).max(100),
  slowListens: z.number().int().min(0).max(100),
  rereads: z.number().int().min(0).max(20),
  helpWordIds: z.array(uuid).max(100),
  selfCheck: z.enum(["easy", "ok", "hard"]).nullable(),
});

export const syncEventSchema = z
  .discriminatedUnion("kind", [
    attemptEventSchema,
    lessonRunEventSchema,
    assessmentRunEventSchema,
    readingEventSchema,
  ])
  .refine((e) => e.kind !== "attempt" || !e.assessmentAttemptId || !!e.assessmentId, {
    message: "an assessment answer must name its assessment",
    path: ["assessmentId"],
  })
  .refine((e) => e.kind !== "attempt" || !(e.assessmentAttemptId && e.lessonRunId), {
    message: "an answer belongs to a lesson run or an assessment, not both",
    path: ["lessonRunId"],
  });
export type SyncEvent = z.infer<typeof syncEventSchema>;
export type AttemptEvent = z.infer<typeof attemptEventSchema>;
export type LessonRunEvent = z.infer<typeof lessonRunEventSchema>;
export type AssessmentRunEvent = z.infer<typeof assessmentRunEventSchema>;
export type ReadingEvent = z.infer<typeof readingEventSchema>;

export const MAX_EVENTS_PER_REQUEST = 200;

export const syncRequestSchema = z.object({
  childId: uuid,
  events: z.array(syncEventSchema).min(1).max(MAX_EVENTS_PER_REQUEST),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

// stored = written now; duplicate = already stored earlier (safe to drop locally);
// obsolete = recorded before the child's learning was reset (dropped locally, never stored);
// rejected = will never be accepted (kept on the device and shown to the parent).
export type SyncResult = {
  id: string;
  status: "stored" | "duplicate" | "obsolete" | "rejected";
  reason?: string;
};

export type SyncResponse = {
  results: SyncResult[];
  newAchievements: { code: string; title: string; emoji: string }[];
};
