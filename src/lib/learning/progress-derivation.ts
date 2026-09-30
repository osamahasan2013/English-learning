import {
  questionTypeSchemas,
  isSupportedQuestionType,
  type AnswerSpec,
} from "@/lib/content/question-schemas";
import { evaluateResponse } from "@/lib/learning/evaluate";
import { masteryRank, type MasteryStatus } from "@/lib/learning/mastery";
import { DEFAULT_RULES, type ScoringRules } from "@/lib/learning/rules";
import { attemptScore, percentage } from "@/lib/learning/scoring";
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
        learning_session_id: string | null;
        attempt_number: number;
        response: AttemptEvent["response"];
        correct_answer: AnswerSpec | null;
        is_correct: boolean;
        score: number;
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
  scoring: ScoringRules = DEFAULT_RULES.scoring,
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
      learning_session_id: event.sessionId ?? null,
      attempt_number: event.attemptNumber,
      response: response.data,
      correct_answer: answer.data,
      is_correct: result.isCorrect,
      score: attemptScore(result.isCorrect, event.attemptNumber, scoring),
      error_type: result.errorType,
      response_time_ms: event.responseTimeMs,
      attempted_at: clampTimestamp(event.attemptedAt, now),
    },
  };
}

export type RunRow = {
  id?: string;
  lesson_id: string;
  score_percent: number;
  stars: number;
  started_at?: string;
  completed_at: string;
};

// A stored answer, as the progress derivations need it.
export type AttemptFact = {
  question_id: string;
  activity_id: string | null;
  lesson_id: string | null;
  lesson_run_id: string | null;
  attempt_number: number;
  is_correct: boolean;
  attempted_at: string;
};

type ProgressStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

const minIso = (values: (string | null | undefined)[]) =>
  values.filter((v): v is string => !!v).sort()[0] ?? null;
const maxIso = (values: (string | null | undefined)[]) =>
  values
    .filter((v): v is string => !!v)
    .sort()
    .at(-1) ?? null;

// One activity: COMPLETED once every scored question in it has had a first try (in any
// run), or — for an unscored activity such as an intro — once its lesson was completed.
// Score = best first-try percentage in a single run.
export function deriveActivityProgress(args: {
  childId: string;
  activityId: string;
  lessonId: string;
  scoredQuestionIds: string[];
  attempts: AttemptFact[];
  lessonCompletedAt: string | null;
}) {
  const questionIds = new Set(args.scoredQuestionIds);
  const mine = args.attempts.filter(
    (a) => a.activity_id === args.activityId && questionIds.has(a.question_id),
  );
  const firstAnswered = new Map<string, string>();
  for (const a of [...mine].sort((x, y) => x.attempted_at.localeCompare(y.attempted_at))) {
    if (a.attempt_number === 1 && !firstAnswered.has(a.question_id))
      firstAnswered.set(a.question_id, a.attempted_at);
  }
  const byRun = new Map<string, Map<string, boolean>>();
  for (const a of mine) {
    if (a.attempt_number !== 1) continue;
    const key = a.lesson_run_id ?? "none";
    const run = byRun.get(key) ?? new Map<string, boolean>();
    if (!run.has(a.question_id)) run.set(a.question_id, a.is_correct);
    byRun.set(key, run);
  }
  const total = questionIds.size;
  const score = Math.max(
    0,
    ...[...byRun.values()].map((run) => percentage([...run.values()].filter(Boolean).length, total)),
  );
  const correct = mine.filter((a) => a.is_correct).length;

  let status: ProgressStatus = "NOT_STARTED";
  let completedAt: string | null = null;
  if (total > 0 && firstAnswered.size === total) {
    status = "COMPLETED";
    completedAt = maxIso([...firstAnswered.values()]);
  } else if (total === 0 && args.lessonCompletedAt) {
    status = "COMPLETED";
    completedAt = args.lessonCompletedAt;
  } else if (mine.length > 0) {
    status = "IN_PROGRESS";
  }
  return {
    child_id: args.childId,
    activity_id: args.activityId,
    lesson_id: args.lessonId,
    status,
    questions_total: total,
    questions_answered: firstAnswered.size,
    attempts: mine.length,
    correct_attempts: correct,
    accuracy: percentage(correct, mine.length),
    score,
    started_at: minIso(mine.map((a) => a.attempted_at)) ?? completedAt,
    last_attempt_at: maxIso(mine.map((a) => a.attempted_at)),
    completed_at: completedAt,
    updated_at: new Date().toISOString(),
  };
}

// One lesson: COMPLETED once it has a finished run; IN_PROGRESS with answers but no run
// yet (the child stopped part-way); scores come from the server-scored runs.
export function deriveLessonProgress(args: {
  childId: string;
  lessonId: string;
  runs: RunRow[];
  attempts: AttemptFact[];
  activitiesTotal: number;
  activitiesCompleted: number;
}) {
  const runs = args.runs
    .filter((r) => r.lesson_id === args.lessonId)
    .sort((a, b) => a.completed_at.localeCompare(b.completed_at));
  const attempts = args.attempts.filter((a) => a.lesson_id === args.lessonId);
  const last = runs.at(-1);
  const correct = attempts.filter((a) => a.is_correct).length;
  const status: ProgressStatus =
    runs.length > 0 ? "COMPLETED" : attempts.length > 0 ? "IN_PROGRESS" : "NOT_STARTED";
  return {
    child_id: args.childId,
    lesson_id: args.lessonId,
    status,
    runs_count: runs.length,
    best_score: Math.max(0, ...runs.map((r) => Number(r.score_percent))),
    last_score: last ? Number(last.score_percent) : 0,
    best_stars: Math.max(0, ...runs.map((r) => r.stars)),
    attempts: attempts.length,
    correct_attempts: correct,
    accuracy: percentage(correct, attempts.length),
    activities_total: args.activitiesTotal,
    activities_completed: Math.min(args.activitiesCompleted, args.activitiesTotal),
    started_at: minIso([
      ...attempts.map((a) => a.attempted_at),
      ...runs.map((r) => r.started_at ?? r.completed_at),
    ]),
    last_attempt_at: maxIso(attempts.map((a) => a.attempted_at)),
    completed_at: runs[0]?.completed_at ?? null,
    last_completed_at: last?.completed_at ?? null,
    updated_at: new Date().toISOString(),
  };
}

export type LessonProgressFact = {
  lesson_id: string;
  status: ProgressStatus;
  best_score: number;
  attempts: number;
  correct_attempts: number;
  started_at: string | null;
  last_attempt_at: string | null;
  completed_at: string | null;
};

// Totals over a set of lessons (one subject in a level, or a whole level).
export function rollUpLessons(lessonIds: string[], progress: ReadonlyMap<string, LessonProgressFact>) {
  const rows = lessonIds.map((id) => progress.get(id)).filter((r): r is LessonProgressFact => !!r);
  const completed = rows.filter((r) => r.status === "COMPLETED");
  const attempts = rows.reduce((n, r) => n + r.attempts, 0);
  const correct = rows.reduce((n, r) => n + r.correct_attempts, 0);
  const allDone = lessonIds.length > 0 && completed.length === lessonIds.length;
  const status: ProgressStatus = allDone
    ? "COMPLETED"
    : rows.some((r) => r.status !== "NOT_STARTED")
      ? "IN_PROGRESS"
      : "NOT_STARTED";
  return {
    status,
    lessons_total: lessonIds.length,
    lessons_completed: completed.length,
    attempts,
    correct_attempts: correct,
    accuracy: percentage(correct, attempts),
    // Average best score of the lessons completed so far.
    score: completed.length
      ? Math.round((100 * completed.reduce((n, r) => n + Number(r.best_score), 0)) / completed.length) / 100
      : 0,
    started_at: minIso(rows.map((r) => r.started_at)),
    last_attempt_at: maxIso(rows.map((r) => r.last_attempt_at)),
    completed_at: allDone ? maxIso(completed.map((r) => r.completed_at)) : null,
    updated_at: new Date().toISOString(),
  };
}

export function countMastered(skillIds: string[], mastery: ReadonlyMap<string, MasteryStatus>) {
  return skillIds.filter((id) => masteryRank(mastery.get(id) ?? "NOT_STARTED") >= masteryRank("MASTERED"))
    .length;
}

export const MAX_SESSION_SECONDS = 43200;

// One learning session, derived from the answers and lesson runs that carry its id.
// An activity counts as completed in the session when all its scored questions got a
// first try within one run of the session (unscored activities: when their lesson run
// finished in the session).
export function deriveSession(args: {
  sessionId: string;
  childId: string;
  attempts: (AttemptFact & { attempted_at: string })[];
  runs: { id: string; lesson_id: string; started_at: string; completed_at: string }[];
  activities: ReadonlyMap<string, { lessonId: string; scoredQuestions: number }>;
}) {
  const times = [
    ...args.attempts.map((a) => a.attempted_at),
    ...args.runs.flatMap((r) => [r.started_at, r.completed_at]),
  ];
  const startedAt = minIso(times) ?? new Date().toISOString();
  const endedAt = maxIso(times) ?? startedAt;
  const firstTries = new Map<string, boolean>();
  for (const a of args.attempts) {
    const key = `${a.lesson_run_id ?? "none"}|${a.question_id}`;
    if (a.attempt_number === 1 && !firstTries.has(key)) firstTries.set(key, a.is_correct);
  }

  const answeredPerRunActivity = new Map<string, Set<string>>();
  for (const a of args.attempts) {
    if (a.attempt_number !== 1 || !a.activity_id) continue;
    const key = `${a.lesson_run_id ?? "none"}|${a.activity_id}`;
    const set = answeredPerRunActivity.get(key) ?? new Set<string>();
    set.add(a.question_id);
    answeredPerRunActivity.set(key, set);
  }
  let activitiesCompleted = 0;
  for (const [key, answered] of answeredPerRunActivity) {
    const activity = args.activities.get(key.split("|")[1]);
    if (activity && activity.scoredQuestions > 0 && answered.size >= activity.scoredQuestions)
      activitiesCompleted++;
  }
  for (const run of args.runs) {
    for (const activity of args.activities.values()) {
      if (activity.lessonId === run.lesson_id && activity.scoredQuestions === 0) activitiesCompleted++;
    }
  }

  const correct = args.attempts.filter((a) => a.is_correct).length;
  return {
    id: args.sessionId,
    child_id: args.childId,
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: Math.min(
      MAX_SESSION_SECONDS,
      Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)),
    ),
    lessons_completed: args.runs.length,
    activities_completed: activitiesCompleted,
    attempts: args.attempts.length,
    correct_attempts: correct,
    score: percentage([...firstTries.values()].filter(Boolean).length, firstTries.size),
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
