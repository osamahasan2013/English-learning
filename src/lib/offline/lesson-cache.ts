import { getLearningDb } from "@/lib/offline/db";
import type { LessonPayload } from "@/lib/learning/lesson-payload";

// Keeps the lessons a child has opened on the device (bounded), so they can be replayed
// without a connection.
const MAX_CACHED_LESSONS = 60;

export async function cacheLesson(payload: LessonPayload) {
  const db = getLearningDb();
  await db.lessons.put({ lessonId: payload.lesson.id, payload, cachedAt: Date.now() });
  const count = await db.lessons.count();
  if (count > MAX_CACHED_LESSONS) {
    const oldest = await db.lessons
      .orderBy("cachedAt")
      .limit(count - MAX_CACHED_LESSONS)
      .primaryKeys();
    await db.lessons.bulkDelete(oldest);
  }
}

export async function getCachedLesson(lessonId: string) {
  return (await getLearningDb().lessons.get(lessonId))?.payload ?? null;
}
