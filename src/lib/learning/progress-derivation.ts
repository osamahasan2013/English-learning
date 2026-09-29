import {
  questionTypeSchemas,
  isSupportedQuestionType,
  type AnswerSpec,
} from "@/lib/content/question-schemas";
import { evaluateResponse } from "@/lib/learning/evaluate";
import type { AttemptEvent } from "@/lib/offline/sync-protocol";

// Pure functions the progress writer uses to turn synced events into stored rows and to
// derive progress caches from stored history. Kept free of I/O so they are unit-tested.

export type StoredQuestion = {
  id: string;
  skill_id: string;
  question_type: string;
  answer: unknown;
  version: number;
  activity_id: string | null;
  lesson_id: string | null;
  word_id: string | null;
};

// Device clocks can be wrong. Keep the child's timestamp when plausible, otherwise clamp
// it, so a bad clock cannot put learning in the future or years in the past.
export const MAX_ATTEMPT_AGE_MS = 60 * 24 * 60 * 60 * 1000;
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function clampTimestamp(value: string, now: Date) {
  const t = new Date(value).getTime();
  const min = now.getTime() - MAX_ATTEMPT_AGE_MS;
  const max = now.getTime() + MAX_CLOCK_SKEW_MS;
  if (Number.isNaN(t)) return now.toISOString();
  return new Date(Math.min(Math.max(t, min), max)).toISOString();
}

export type AttemptRowResult =
  | {
      ok: true;
      row: {
        id: string;
        child_id: string;
        question_id: string;
        question_version: number;
        question_type: string;
        skill_id: string;
        activity_id: string | null;
        lesson_id: string | null;
        word_id: string | null;
        lesson_run_id: string | null;
        attempt_number: number;
        response: AttemptEvent["response"];
        correct_answer: AnswerSpec | null;
        is_correct: boolean;
        error_type: string | null;
        response_time_ms: number;
        attempted_at: string;
      };
    }
  | { ok: false; reason: string };

// Re-evaluates the answer against the stored question. The device's own verdict is never
// part of the event, so it cannot be forged.
export function buildAttemptRow(
  question: StoredQuestion,
  event: AttemptEvent,
  childId: string,
  now: Date,
): AttemptRowResult {
  if (!isSupportedQuestionType(question.question_type))
    return { ok: false, reason: "unsupported_question_type" };
  const schemas = questionTypeSchemas[question.question_type];
  if (schemas.answer === null || schemas.response === null)
    return { ok: false, reason: "question_not_scored" };
  const answer = schemas.answer.safeParse(question.answer);
  if (!answer.success) return { ok: false, reason: "question_answer_invalid" };
  const response = schemas.response.safeParse(event.response);
  if (!response.success) return { ok: false, reason: "response_shape_invalid" };

  const result = evaluateResponse(question.question_type, answer.data, response.data);
  return {
    ok: true,
    row: {
      id: event.id,
      child_id: childId,
      question_id: question.id,
      question_version: question.version,
      question_type: question.question_type,
      skill_id: question.skill_id,
      activity_id: question.activity_id,
      lesson_id: question.lesson_id,
      word_id: question.word_id,
      lesson_run_id: event.lessonRunId,
      attempt_number: event.attemptNumber,
      response: response.data,
      correct_answer: answer.data,
      is_correct: result.isCorrect,
      error_type: result.errorType,
      response_time_ms: event.responseTimeMs,
      attempted_at: clampTimestamp(event.attemptedAt, now),
    },
  };
}

export type RunRow = { lesson_id: string; score_percent: number; stars: number; completed_at: string };

export function aggregateLessonProgress(childId: string, lessonId: string, runs: RunRow[]) {
  const forLesson = runs
    .filter((r) => r.lesson_id === lessonId)
    .sort((a, b) => a.completed_at.localeCompare(b.completed_at));
  const last = forLesson.at(-1);
  return {
    child_id: childId,
    lesson_id: lessonId,
    runs_count: forLesson.length,
    best_score: Math.max(0, ...forLesson.map((r) => Number(r.score_percent))),
    last_score: last ? Number(last.score_percent) : 0,
    best_stars: Math.max(0, ...forLesson.map((r) => r.stars)),
    first_completed_at: forLesson[0]?.completed_at ?? null,
    last_completed_at: last?.completed_at ?? null,
    updated_at: new Date().toISOString(),
  };
}

// "Learned" = answered correctly on the first try at least this many times.
export const WORD_LEARNED_CORRECT_COUNT = 2;

export function aggregateWordAttempts(
  attempts: { word_id: string; is_correct: boolean; attempted_at: string }[],
) {
  const byWord = new Map<
    string,
    { attempts_count: number; correct_count: number; last_practiced_at: string }
  >();
  for (const a of attempts) {
    const entry = byWord.get(a.word_id) ?? {
      attempts_count: 0,
      correct_count: 0,
      last_practiced_at: a.attempted_at,
    };
    entry.attempts_count += 1;
    if (a.is_correct) entry.correct_count += 1;
    if (a.attempted_at > entry.last_practiced_at) entry.last_practiced_at = a.attempted_at;
    byWord.set(a.word_id, entry);
  }
  return byWord;
}
