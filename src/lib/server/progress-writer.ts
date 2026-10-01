import "server-only";

import { isAchievementEarned } from "@/lib/learning/achievements";
import {
  scoreSkillCheck,
  skillCheckConfigSchema,
  type AssessmentItemFact,
} from "@/lib/learning/assessment-scoring";
import { currentStreak } from "@/lib/learning/analytics";
import { computeMastery } from "@/lib/learning/mastery";
import {
  attemptRejection,
  buildAttemptRow,
  clampTimestamp,
  countMastered,
  deriveActivityProgress,
  deriveLessonProgress,
  deriveSession,
  rollUpLessons,
  scoreRun,
  WORD_LEARNED_CORRECT_COUNT,
  type AttemptFact,
  type LessonProgressFact,
  type StoredQuestion,
} from "@/lib/learning/progress-derivation";
import {
  autoSaveDecision,
  computeWordProgress,
  deriveWordReview,
  wordAreaFor,
} from "@/lib/learning/vocabulary";
import { deriveSkillReviewItem, skillKey, wordKey, type ReviewItemRow } from "@/lib/learning/review-queue";
import type { LearningRules } from "@/lib/learning/rules";
import { scoreLesson } from "@/lib/learning/scoring";
import type { MasteryStatus } from "@/lib/learning/mastery";
import type {
  AssessmentRunEvent,
  AttemptEvent,
  LessonRunEvent,
  SyncEvent,
  SyncResponse,
  SyncResult,
} from "@/lib/offline/sync-protocol";
import { logger } from "@/lib/logging";
import { loadLearningRules } from "@/lib/server/learning-rules";
import { createAdminClient } from "@/lib/supabase/admin";

// Writes a batch of synced learning events for ONE child. The caller must already have
// verified that the signed-in parent owns `childId` (see app/api/sync/route.ts); this
// module uses the service role and trusts that check.
//
// Order: learning sessions and assessment sittings (so events can reference them) →
// attempts → lesson runs → assessment results →
// derived caches (activity, lesson, subject and level progress; skill mastery; review
// queue; words; session totals) → rewards and achievements. Every step is idempotent and
// every cache is recomputed from stored history, so a retry after a partial failure — or
// the same event sent twice — converges on the same state.

const ACHIEVEMENT_POINTS = 20;

type Db = ReturnType<typeof createAdminClient>;

export async function processSyncBatch(
  childId: string,
  events: SyncEvent[],
  now = new Date(),
): Promise<SyncResponse> {
  const db = createAdminClient();
  const rules = await loadLearningRules(db);
  const results = new Map<string, SyncResult>();

  const sessionEvents = await attachSessions(db, childId, events, now);
  const usable = await attachAssessmentAttempts(db, childId, sessionEvents, now, results);
  const attempts = usable.filter((e): e is AttemptEvent => e.kind === "attempt");
  const runs = usable.filter((e): e is LessonRunEvent => e.kind === "lesson_run");
  const sittings = usable.filter((e): e is AssessmentRunEvent => e.kind === "assessment_run");

  const stored = await storeAttempts(db, childId, attempts, now, results, rules);
  const newRuns = await storeLessonRuns(db, childId, runs, now, results, rules);
  const assessed = await storeAssessmentResults(db, childId, sittings, now, results, rules);
  for (const id of assessed.sessionIds) newRuns.sessionIds.add(id);

  const lessonIds = new Set([...stored.lessonIds, ...newRuns.lessonIds]);
  if (lessonIds.size > 0) await recomputeLessonTree(db, childId, [...lessonIds]);
  if (stored.newSkillIds.size > 0)
    await recomputeSkillMastery(db, childId, [...stored.newSkillIds], now, rules);
  if (assessed.skillIds.size > 0) await markAssessed(db, childId, assessed, now);
  if (stored.newWordIds.size > 0)
    await recomputeWordProgress(db, childId, [...stored.newWordIds], now, rules);
  if (lessonIds.size > 0 || stored.newSkillIds.size > 0)
    await recomputeLevelRollups(db, childId, [...lessonIds]);
  const sessionIds = new Set([...stored.sessionIds, ...newRuns.sessionIds]);
  if (sessionIds.size > 0) await recomputeSessions(db, childId, [...sessionIds]);
  const newAchievements =
    newRuns.lessonIds.size > 0 || assessed.skillIds.size > 0 || stored.newWordIds.size > 0
      ? await awardAchievements(db, childId, now)
      : [];

  return {
    results: events.map(
      (e) => results.get(e.id) ?? { id: e.id, status: "rejected", reason: "not_processed" },
    ),
    newAchievements,
  };
}

async function existingIds(db: Db, table: "activity_attempts" | "lesson_runs", ids: string[]) {
  if (ids.length === 0) return new Set<string>();
  const { data, error } = await db.from(table).select("id").in("id", ids);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.id));
}

// Makes sure every session an event names exists for this child. A session id that
// already belongs to another child is never shared: the event is kept but detached from it.
async function attachSessions(db: Db, childId: string, events: SyncEvent[], now: Date): Promise<SyncEvent[]> {
  const ids = [...new Set(events.map((e) => e.sessionId).filter((id): id is string => !!id))];
  if (ids.length === 0) return events;
  const { data: existing, error } = await db.from("learning_sessions").select("id, child_id").in("id", ids);
  if (error) throw error;
  const foreign = new Set((existing ?? []).filter((s) => s.child_id !== childId).map((s) => s.id));
  if (foreign.size > 0) logger.warn("sync.session_not_owned", { childId, count: foreign.size });
  const known = new Set((existing ?? []).map((s) => s.id));
  const placeholders = ids
    .filter((id) => !known.has(id))
    .map((id) => {
      const times = events
        .filter((e) => e.sessionId === id)
        .map((e) => clampTimestamp("attemptedAt" in e ? e.attemptedAt : e.startedAt, now))
        .sort();
      // Totals are filled in by recomputeSessions once the events are stored.
      return {
        id,
        child_id: childId,
        started_at: times[0],
        ended_at: times.at(-1)!,
        duration_seconds: 0,
      };
    });
  if (placeholders.length > 0) {
    const { error: insertError } = await db
      .from("learning_sessions")
      .upsert(placeholders, { onConflict: "id", ignoreDuplicates: true });
    if (insertError) throw insertError;
    // A concurrent request for another child could have won the insert: re-check.
    const { data: after, error: afterError } = await db
      .from("learning_sessions")
      .select("id, child_id")
      .in(
        "id",
        placeholders.map((p) => p.id),
      );
    if (afterError) throw afterError;
    for (const s of after ?? []) if (s.child_id !== childId) foreign.add(s.id);
  }
  return events.map((e) => (e.sessionId && foreign.has(e.sessionId) ? { ...e, sessionId: null } : e));
}

// Creates the assessment sitting (assessment_attempts) that assessment answers point to,
// before the answers are stored. A sitting id that already belongs to another child or
// another assessment is never shared: its events are rejected.
async function attachAssessmentAttempts(
  db: Db,
  childId: string,
  events: SyncEvent[],
  now: Date,
  results: Map<string, SyncResult>,
): Promise<SyncEvent[]> {
  const sittingOf = (e: SyncEvent) =>
    e.kind === "assessment_run"
      ? { id: e.id, assessmentId: e.assessmentId, at: e.startedAt }
      : e.kind === "attempt" && e.assessmentAttemptId && e.assessmentId
        ? { id: e.assessmentAttemptId, assessmentId: e.assessmentId, at: e.attemptedAt }
        : null;
  const wanted = new Map<string, { assessmentId: string; at: string }>();
  for (const e of events) {
    const s = sittingOf(e);
    if (!s) continue;
    const at = clampTimestamp(s.at, now);
    const prev = wanted.get(s.id);
    if (!prev || at < prev.at) wanted.set(s.id, { assessmentId: prev?.assessmentId ?? s.assessmentId, at });
  }
  if (wanted.size === 0) return events;

  const ids = [...wanted.keys()];
  const assessmentIds = [...new Set([...wanted.values()].map((w) => w.assessmentId))];
  const [{ data: assessments, error }, { data: existing, error: existingError }] = await Promise.all([
    db.from("assessments").select("id, assessment_type, status").in("id", assessmentIds),
    db.from("assessment_attempts").select("id, child_id, assessment_id").in("id", ids),
  ]);
  if (error || existingError) throw error ?? existingError;
  const published = new Map(
    (assessments ?? []).filter((a) => a.status === "published").map((a) => [a.id, a.assessment_type]),
  );
  const bad = new Map<string, string>();
  for (const [id, w] of wanted) if (!published.has(w.assessmentId)) bad.set(id, "unknown_assessment");
  const known = new Set<string>();
  for (const row of existing ?? []) {
    known.add(row.id);
    if (row.child_id !== childId || row.assessment_id !== wanted.get(row.id)?.assessmentId)
      bad.set(row.id, "assessment_attempt_not_owned");
  }
  const placeholders = ids
    .filter((id) => !known.has(id) && !bad.has(id))
    .map((id) => {
      const w = wanted.get(id)!;
      return {
        id,
        child_id: childId,
        assessment_id: w.assessmentId,
        purpose: published.get(w.assessmentId) === "placement" ? "placement" : "skill_check",
        started_at: w.at,
      };
    });
  if (placeholders.length > 0) {
    const { error: insertError } = await db
      .from("assessment_attempts")
      .upsert(placeholders, { onConflict: "id", ignoreDuplicates: true });
    if (insertError) throw insertError;
    // A concurrent request for another child could have won the insert: re-check.
    const { data: after, error: afterError } = await db
      .from("assessment_attempts")
      .select("id, child_id, assessment_id")
      .in(
        "id",
        placeholders.map((p) => p.id),
      );
    if (afterError) throw afterError;
    for (const row of after ?? [])
      if (row.child_id !== childId || row.assessment_id !== wanted.get(row.id)?.assessmentId)
        bad.set(row.id, "assessment_attempt_not_owned");
  }
  if (bad.size > 0) logger.warn("sync.assessment_attempt_rejected", { childId, count: bad.size });
  return events.filter((e) => {
    const s = sittingOf(e);
    const reason = s ? bad.get(s.id) : undefined;
    if (reason) results.set(e.id, { id: e.id, status: "rejected", reason });
    return !reason;
  });
}

// Scores a finished assessment sitting from its stored first tries (never from the
// device) and stores the result once.
async function storeAssessmentResults(
  db: Db,
  childId: string,
  sittings: AssessmentRunEvent[],
  now: Date,
  results: Map<string, SyncResult>,
  rules: LearningRules,
) {
  const skillIds = new Set<string>();
  const sessionIds = new Set<string>();
  const assessedAt = new Map<string, string>();
  if (sittings.length === 0) return { skillIds, sessionIds, assessedAt };

  const { data: done, error } = await db
    .from("assessment_results")
    .select("assessment_attempt_id")
    .in(
      "assessment_attempt_id",
      sittings.map((s) => s.id),
    );
  if (error) throw error;
  const already = new Set((done ?? []).map((r) => r.assessment_attempt_id));

  for (const sitting of sittings) {
    if (already.has(sitting.id)) {
      results.set(sitting.id, { id: sitting.id, status: "duplicate" });
      continue;
    }
    const [{ data: assessment, error: assessmentError }, { data: items, error: itemsError }, tries] =
      await Promise.all([
        db.from("assessments").select("id, config").eq("id", sitting.assessmentId).maybeSingle(),
        db
          .from("assessment_items")
          .select("question_id, stage, stage_label, sort_order, questions(skill_id, status, skills(code))")
          .eq("assessment_id", sitting.assessmentId)
          .order("stage")
          .order("sort_order"),
        db
          .from("activity_attempts")
          .select("question_id, is_correct")
          .eq("child_id", childId)
          .eq("assessment_attempt_id", sitting.id)
          .eq("attempt_number", 1),
      ]);
    if (assessmentError || itemsError || tries.error) throw assessmentError ?? itemsError ?? tries.error;
    if (!assessment) {
      results.set(sitting.id, { id: sitting.id, status: "rejected", reason: "unknown_assessment" });
      continue;
    }
    const firstTries = new Map((tries.data ?? []).map((a) => [a.question_id, a.is_correct]));
    if (firstTries.size === 0) {
      results.set(sitting.id, { id: sitting.id, status: "rejected", reason: "no_attempts_for_run" });
      continue;
    }
    const facts: AssessmentItemFact[] = (items ?? []).flatMap((i) => {
      const q = Array.isArray(i.questions) ? i.questions[0] : i.questions;
      if (!q || q.status !== "published") return [];
      const skill = Array.isArray(q.skills) ? q.skills[0] : q.skills;
      return [
        {
          questionId: i.question_id,
          stage: i.stage,
          stageLabel: i.stage_label,
          skillId: q.skill_id,
          skillCode: skill?.code ?? q.skill_id,
        },
      ];
    });
    const config = skillCheckConfigSchema.safeParse(assessment.config);
    const outcome = scoreSkillCheck(facts, firstTries, config.success ? config.data.areaPassPercent : 75);
    const score = scoreLesson(
      facts.map((f) => ({ isCorrect: firstTries.get(f.questionId) === true })),
      rules.scoring,
    );
    const completedAt = clampTimestamp(sitting.completedAt, now);

    const { error: attemptError } = await db
      .from("assessment_attempts")
      .update({ completed_at: completedAt })
      .eq("id", sitting.id)
      .eq("child_id", childId);
    if (attemptError) throw attemptError;
    const { error: resultError } = await db.from("assessment_results").upsert(
      {
        assessment_attempt_id: sitting.id,
        child_id: childId,
        overall_score: outcome.overallPercent,
        dimension_scores: Object.fromEntries(
          outcome.areas.map((a) => [
            a.label,
            { stage: a.stage, correct: a.correct, total: a.total, percent: a.percent, secure: a.secure },
          ]),
        ),
        skill_scores: outcome.skills,
      },
      { onConflict: "assessment_attempt_id", ignoreDuplicates: true },
    );
    if (resultError) throw resultError;
    const { error: rewardError } = await db.from("reward_events").upsert(
      {
        child_id: childId,
        source_type: "assessment",
        source_id: sitting.id,
        points: score.points,
        stars: score.stars,
      },
      { onConflict: "child_id,source_type,source_id", ignoreDuplicates: true },
    );
    if (rewardError) throw rewardError;
    results.set(sitting.id, { id: sitting.id, status: "stored" });
    for (const f of facts) {
      skillIds.add(f.skillId);
      if (!assessedAt.has(f.skillId) || assessedAt.get(f.skillId)! < completedAt)
        assessedAt.set(f.skillId, completedAt);
    }
    if (sitting.sessionId) sessionIds.add(sitting.sessionId);
  }
  return { skillIds, sessionIds, assessedAt };
}

// Records when each measured skill was last assessed (after mastery was recomputed, so
// the row exists for every skill the child answered).
async function markAssessed(
  db: Db,
  childId: string,
  assessed: { assessedAt: Map<string, string> },
  now: Date,
) {
  for (const [skillId, at] of assessed.assessedAt) {
    const { error } = await db
      .from("skill_mastery")
      .update({ last_assessed_at: at, updated_at: now.toISOString() })
      .eq("child_id", childId)
      .eq("skill_id", skillId);
    if (error) throw error;
  }
}

async function storeAttempts(
  db: Db,
  childId: string,
  attempts: AttemptEvent[],
  now: Date,
  results: Map<string, SyncResult>,
  rules: LearningRules,
) {
  const newSkillIds = new Set<string>();
  const newWordIds = new Set<string>();
  const lessonIds = new Set<string>();
  const sessionIds = new Set<string>();
  if (attempts.length === 0) return { newSkillIds, newWordIds, lessonIds, sessionIds };

  const already = await existingIds(
    db,
    "activity_attempts",
    attempts.map((a) => a.id),
  );
  const pending = attempts.filter((a) => {
    if (already.has(a.id)) {
      results.set(a.id, { id: a.id, status: "duplicate" });
      return false;
    }
    return true;
  });
  if (pending.length === 0) return { newSkillIds, newWordIds, lessonIds, sessionIds };

  const questionIds = [...new Set(pending.map((a) => a.questionId))];
  const { data: questionRows, error } = await db
    .from("questions")
    .select(
      "id, skill_id, question_type, answer, version, activity_id, word_id, status, activities(lesson_id, status, config, lessons(status))",
    )
    .in("id", questionIds);
  if (error) throw error;
  const questions = new Map<string, StoredQuestion>();
  // Only published content counts: a draft or archived question (or one in an unpublished
  // activity or lesson) is never evidence, and its answer must not be recorded.
  const eligibility = new Map<string, { available: boolean; maxTries: number }>();
  for (const q of questionRows ?? []) {
    const activity = Array.isArray(q.activities) ? q.activities[0] : q.activities;
    const lesson = activity
      ? Array.isArray(activity.lessons)
        ? activity.lessons[0]
        : activity.lessons
      : null;
    questions.set(q.id, {
      id: q.id,
      skill_id: q.skill_id,
      question_type: q.question_type,
      answer: q.answer,
      version: q.version,
      activity_id: q.activity_id,
      word_id: q.word_id,
      lesson_id: activity?.lesson_id ?? null,
    });
    const configTries = (activity?.config as { maxTries?: unknown } | null)?.maxTries;
    eligibility.set(q.id, {
      available:
        q.status === "published" &&
        (!q.activity_id || (activity?.status === "published" && lesson?.status === "published")),
      maxTries: typeof configTries === "number" ? configTries : rules.player.maxTries,
    });
  }

  // One first try per question per lesson run (or assessment sitting): a second one is a
  // replayed or forged answer and would skew the score. Enforced by unique indexes too.
  const firstTryKey = (a: AttemptEvent) =>
    a.attemptNumber !== 1
      ? null
      : a.assessmentAttemptId
        ? `${a.questionId}|sitting:${a.assessmentAttemptId}`
        : a.lessonRunId
          ? `${a.questionId}|run:${a.lessonRunId}`
          : null;
  const takenFirstTries = await existingFirstTries(db, childId, pending);

  // Assessment answers must be for a question of that assessment.
  const assessmentIds = [...new Set(pending.map((a) => a.assessmentId).filter((id): id is string => !!id))];
  const assessmentQuestions = new Set<string>();
  if (assessmentIds.length > 0) {
    const { data: items, error: itemsError } = await db
      .from("assessment_items")
      .select("assessment_id, question_id")
      .in("assessment_id", assessmentIds);
    if (itemsError) throw itemsError;
    for (const i of items ?? []) assessmentQuestions.add(`${i.assessment_id}:${i.question_id}`);
  }

  const rows = [];
  for (const attempt of pending) {
    const question = questions.get(attempt.questionId);
    if (!question) {
      results.set(attempt.id, { id: attempt.id, status: "rejected", reason: "unknown_question" });
      continue;
    }
    if (attempt.assessmentAttemptId && !assessmentQuestions.has(`${attempt.assessmentId}:${question.id}`)) {
      results.set(attempt.id, { id: attempt.id, status: "rejected", reason: "question_not_in_assessment" });
      continue;
    }
    const rejection = attemptRejection(question, eligibility.get(question.id)!, attempt);
    if (rejection) {
      results.set(attempt.id, { id: attempt.id, status: "rejected", reason: rejection });
      continue;
    }
    const key = firstTryKey(attempt);
    if (key && takenFirstTries.has(key)) {
      results.set(attempt.id, { id: attempt.id, status: "rejected", reason: "duplicate_first_try" });
      continue;
    }
    const built = buildAttemptRow(question, attempt, childId, now, rules.scoring);
    if (!built.ok) {
      results.set(attempt.id, { id: attempt.id, status: "rejected", reason: built.reason });
      continue;
    }
    if (key) takenFirstTries.add(key);
    rows.push(built.row);
  }
  if (rows.length > 0) {
    // ignoreDuplicates: a concurrent request that stored the same id first wins silently.
    const { error: insertError } = await db
      .from("activity_attempts")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (insertError) throw insertError;
  }
  for (const row of rows) {
    results.set(row.id, { id: row.id, status: "stored" });
    if (row.lesson_id) lessonIds.add(row.lesson_id);
    if (row.learning_session_id) sessionIds.add(row.learning_session_id);
    if (row.attempt_number === 1) {
      newSkillIds.add(row.skill_id);
      if (row.word_id) newWordIds.add(row.word_id);
    }
  }
  return { newSkillIds, newWordIds, lessonIds, sessionIds };
}

// First tries already stored for the runs and sittings these answers name, as
// "question|run:<id>" / "question|sitting:<id>" keys (see storeAttempts).
async function existingFirstTries(db: Db, childId: string, attempts: AttemptEvent[]) {
  const keys = new Set<string>();
  const runIds = [
    ...new Set(attempts.map((a) => (a.assessmentAttemptId ? null : a.lessonRunId)).filter(Boolean)),
  ];
  const sittingIds = [...new Set(attempts.map((a) => a.assessmentAttemptId).filter(Boolean))];
  const [runs, sittings] = await Promise.all([
    runIds.length
      ? db
          .from("activity_attempts")
          .select("question_id, lesson_run_id")
          .eq("child_id", childId)
          .eq("attempt_number", 1)
          .in("lesson_run_id", runIds as string[])
      : null,
    sittingIds.length
      ? db
          .from("activity_attempts")
          .select("question_id, assessment_attempt_id")
          .eq("child_id", childId)
          .eq("attempt_number", 1)
          .in("assessment_attempt_id", sittingIds as string[])
      : null,
  ]);
  if (runs?.error || sittings?.error) throw runs?.error ?? sittings?.error;
  for (const r of runs?.data ?? []) keys.add(`${r.question_id}|run:${r.lesson_run_id}`);
  for (const s of sittings?.data ?? []) keys.add(`${s.question_id}|sitting:${s.assessment_attempt_id}`);
  return keys;
}

async function storeLessonRuns(
  db: Db,
  childId: string,
  runs: LessonRunEvent[],
  now: Date,
  results: Map<string, SyncResult>,
  rules: LearningRules,
) {
  const lessonIds = new Set<string>();
  const sessionIds = new Set<string>();
  if (runs.length === 0) return { lessonIds, sessionIds };

  const already = await existingIds(
    db,
    "lesson_runs",
    runs.map((r) => r.id),
  );
  for (const run of runs) {
    if (already.has(run.id)) {
      results.set(run.id, { id: run.id, status: "duplicate" });
      continue;
    }
    const { data: lesson } = await db
      .from("lessons")
      .select("id, version")
      .eq("id", run.lessonId)
      .eq("status", "published")
      .maybeSingle();
    if (!lesson) {
      results.set(run.id, { id: run.id, status: "rejected", reason: "unknown_lesson" });
      continue;
    }
    // Score from the run's stored first tries at THIS lesson's questions, never from the
    // device (scoreRun: coverage and scoring rules).
    const [{ data: firstTries, error }, structure] = await Promise.all([
      db
        .from("activity_attempts")
        .select("question_id, is_correct")
        .eq("child_id", childId)
        .eq("lesson_run_id", run.id)
        .eq("lesson_id", lesson.id)
        .eq("attempt_number", 1),
      loadLessonStructure(db, [lesson.id]),
    ]);
    if (error) throw error;
    const scored = scoreRun(
      firstTries ?? [],
      [...structure.values()].flatMap((a) => a.scoredQuestionIds),
      rules.scoring,
    );
    if (!scored.ok) {
      results.set(run.id, { id: run.id, status: "rejected", reason: scored.reason });
      continue;
    }
    const score = scored.score;
    const startedAt = clampTimestamp(run.startedAt, now);
    const completedAt = clampTimestamp(run.completedAt, now);
    const durationSeconds = Math.min(
      7200,
      Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000)),
    );

    const { error: insertError } = await db.from("lesson_runs").upsert(
      {
        id: run.id,
        child_id: childId,
        lesson_id: lesson.id,
        lesson_version: lesson.version,
        learning_session_id: run.sessionId ?? null,
        started_at: completedAt < startedAt ? completedAt : startedAt,
        completed_at: completedAt,
        duration_seconds: durationSeconds,
        total_questions: score.total,
        correct_count: score.correct,
        score_percent: score.percent,
        stars: score.stars,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (insertError) throw insertError;
    const { error: rewardError } = await db.from("reward_events").upsert(
      {
        child_id: childId,
        source_type: "lesson_run",
        source_id: run.id,
        points: score.points,
        stars: score.stars,
      },
      { onConflict: "child_id,source_type,source_id", ignoreDuplicates: true },
    );
    if (rewardError) throw rewardError;
    results.set(run.id, { id: run.id, status: "stored" });
    lessonIds.add(lesson.id);
    if (run.sessionId) sessionIds.add(run.sessionId);
  }
  return { lessonIds, sessionIds };
}

// Published activities of the given lessons and the scored questions in each.
async function loadLessonStructure(db: Db, lessonIds: string[]) {
  const activities = new Map<string, { lessonId: string; scoredQuestionIds: string[] }>();
  if (lessonIds.length === 0) return activities;
  const [{ data: activityRows, error }, { data: types, error: typesError }] = await Promise.all([
    db.from("activities").select("id, lesson_id").in("lesson_id", lessonIds).eq("status", "published"),
    db.from("activity_types").select("code, is_scored"),
  ]);
  if (error || typesError) throw error ?? typesError;
  for (const a of activityRows ?? []) activities.set(a.id, { lessonId: a.lesson_id, scoredQuestionIds: [] });
  if (activities.size === 0) return activities;
  const scored = new Set((types ?? []).filter((t) => t.is_scored).map((t) => t.code));
  const { data: questionRows, error: questionsError } = await db
    .from("questions")
    .select("id, activity_id, question_type")
    .in("activity_id", [...activities.keys()])
    .eq("status", "published");
  if (questionsError) throw questionsError;
  for (const q of questionRows ?? []) {
    if (q.activity_id && scored.has(q.question_type))
      activities.get(q.activity_id)?.scoredQuestionIds.push(q.id);
  }
  return activities;
}

// Activity progress and lesson progress for the given lessons.
async function recomputeLessonTree(db: Db, childId: string, lessonIds: string[]) {
  const [structure, { data: attempts, error }, { data: runs, error: runsError }] = await Promise.all([
    loadLessonStructure(db, lessonIds),
    db
      .from("activity_attempts")
      .select("question_id, activity_id, lesson_id, lesson_run_id, attempt_number, is_correct, attempted_at")
      .eq("child_id", childId)
      .in("lesson_id", lessonIds)
      .order("attempted_at")
      .limit(10000),
    db
      .from("lesson_runs")
      .select("id, lesson_id, score_percent, stars, started_at, completed_at")
      .eq("child_id", childId)
      .in("lesson_id", lessonIds),
  ]);
  if (error || runsError) throw error ?? runsError;
  const facts = (attempts ?? []) as AttemptFact[];

  const activityRows = [...structure].map(([activityId, a]) => {
    const firstRun = (runs ?? [])
      .filter((r) => r.lesson_id === a.lessonId)
      .map((r) => r.completed_at)
      .sort()[0];
    return deriveActivityProgress({
      childId,
      activityId,
      lessonId: a.lessonId,
      scoredQuestionIds: a.scoredQuestionIds,
      attempts: facts,
      lessonCompletedAt: firstRun ?? null,
    });
  });
  const startedActivities = activityRows.filter((r) => r.status !== "NOT_STARTED");
  if (startedActivities.length > 0) {
    const { error: upsertError } = await db
      .from("activity_progress")
      .upsert(startedActivities, { onConflict: "child_id,activity_id" });
    if (upsertError) throw upsertError;
  }

  const lessonRows = lessonIds
    .map((lessonId) => {
      const mine = activityRows.filter((r) => r.lesson_id === lessonId);
      return deriveLessonProgress({
        childId,
        lessonId,
        runs: (runs ?? []).map((r) => ({ ...r, score_percent: Number(r.score_percent) })),
        attempts: facts,
        activitiesTotal: mine.length,
        activitiesCompleted: mine.filter((r) => r.status === "COMPLETED").length,
      });
    })
    .filter((r) => r.status !== "NOT_STARTED");
  if (lessonRows.length > 0) {
    const { error: upsertError } = await db
      .from("lesson_progress")
      .upsert(lessonRows, { onConflict: "child_id,lesson_id" });
    if (upsertError) throw upsertError;
  }
}

// Subject and level progress for every level the given lessons belong to (plus the
// child's current level, so their dashboard always has rows).
async function recomputeLevelRollups(db: Db, childId: string, lessonIds: string[]) {
  const levelIds = new Set<string>();
  if (lessonIds.length > 0) {
    const { data, error } = await db.from("lesson_catalog").select("level_id").in("lesson_id", lessonIds);
    if (error) throw error;
    for (const r of data ?? []) if (r.level_id) levelIds.add(r.level_id);
  }
  const { data: child } = await db
    .from("children")
    .select("current_level_id")
    .eq("id", childId)
    .maybeSingle();
  if (child) levelIds.add(child.current_level_id);
  if (levelIds.size === 0) return;

  const { data: catalog, error } = await db
    .from("lesson_catalog")
    .select("lesson_id, skill_id, subject_id, level_id")
    .in("level_id", [...levelIds])
    .eq("skill_active", true);
  if (error) throw error;
  const lessons = (catalog ?? []).filter(
    (c): c is { lesson_id: string; skill_id: string; subject_id: string; level_id: string } =>
      !!(c.lesson_id && c.skill_id && c.subject_id && c.level_id),
  );
  const allLessonIds = lessons.map((l) => l.lesson_id);
  const allSkillIds = [...new Set(lessons.map((l) => l.skill_id))];
  const [{ data: progressRows, error: progressError }, { data: masteryRows, error: masteryError }] =
    await Promise.all([
      allLessonIds.length
        ? db
            .from("lesson_progress")
            .select(
              "lesson_id, status, best_score, attempts, correct_attempts, started_at, last_attempt_at, completed_at",
            )
            .eq("child_id", childId)
            .in("lesson_id", allLessonIds)
        : Promise.resolve({ data: [], error: null }),
      allSkillIds.length
        ? db
            .from("skill_mastery")
            .select("skill_id, status")
            .eq("child_id", childId)
            .in("skill_id", allSkillIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (progressError || masteryError) throw progressError ?? masteryError;
  const progress = new Map<string, LessonProgressFact>(
    (progressRows ?? []).map((r) => [
      r.lesson_id,
      { ...r, best_score: Number(r.best_score) } as LessonProgressFact,
    ]),
  );
  const mastery = new Map<string, MasteryStatus>((masteryRows ?? []).map((r) => [r.skill_id, r.status]));

  const subjectRows = [];
  const levelRows = [];
  for (const levelId of levelIds) {
    const inLevel = lessons.filter((l) => l.level_id === levelId);
    for (const subjectId of new Set(inLevel.map((l) => l.subject_id))) {
      const ids = inLevel.filter((l) => l.subject_id === subjectId).map((l) => l.lesson_id);
      subjectRows.push({
        child_id: childId,
        level_id: levelId,
        subject_id: subjectId,
        ...rollUpLessons(ids, progress),
      });
    }
    const skillIds = [...new Set(inLevel.map((l) => l.skill_id))];
    levelRows.push({
      child_id: childId,
      level_id: levelId,
      ...rollUpLessons(
        inLevel.map((l) => l.lesson_id),
        progress,
      ),
      skills_total: skillIds.length,
      skills_mastered: countMastered(skillIds, mastery),
    });
  }
  if (subjectRows.length > 0) {
    const { error: upsertError } = await db
      .from("subject_progress")
      .upsert(subjectRows, { onConflict: "child_id,level_id,subject_id" });
    if (upsertError) throw upsertError;
  }
  if (levelRows.length > 0) {
    const { error: upsertError } = await db
      .from("level_progress")
      .upsert(levelRows, { onConflict: "child_id,level_id" });
    if (upsertError) throw upsertError;
  }
}

// The parent's time zone (practice days and streaks follow the family's calendar).
async function familyTimeZone(db: Db, childId: string) {
  const { data, error } = await db
    .from("children")
    .select("profiles(timezone)")
    .eq("id", childId)
    .maybeSingle();
  if (error) throw error;
  const profile = data ? (Array.isArray(data.profiles) ? data.profiles[0] : data.profiles) : null;
  return profile?.timezone ?? "UTC";
}

async function recomputeSkillMastery(
  db: Db,
  childId: string,
  skillIds: string[],
  now: Date,
  rules: LearningRules,
) {
  const [{ data: skills, error }, { data: skillLessons, error: lessonsError }, timeZone] = await Promise.all([
    db
      .from("skills")
      .select("id, mastery_threshold, importance, is_active, phonics_pattern_id")
      .in("id", skillIds),
    db
      .from("lessons")
      .select("id, skill_id, sort_order")
      .in("skill_id", skillIds)
      .eq("status", "published")
      .order("sort_order"),
    familyTimeZone(db, childId),
  ]);
  if (error || lessonsError) throw error ?? lessonsError;
  const firstLesson = new Map<string, string>();
  for (const l of skillLessons ?? []) if (!firstLesson.has(l.skill_id)) firstLesson.set(l.skill_id, l.id);

  const rows = [];
  const reviewRows: ReviewItemRow[] = [];
  for (const skill of skills ?? []) {
    const base = () =>
      db
        .from("activity_attempts")
        .select("id", { count: "exact", head: true })
        .eq("child_id", childId)
        .eq("skill_id", skill.id)
        .eq("attempt_number", 1);
    const [{ data: recent, error: recentError }, total, correct] = await Promise.all([
      db
        .from("activity_attempts")
        .select("id, is_correct, attempted_at")
        .eq("child_id", childId)
        .eq("skill_id", skill.id)
        .eq("attempt_number", 1)
        .order("attempted_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(rules.mastery.windowSize),
      base(),
      base().eq("is_correct", true),
    ]);
    if (recentError || total.error || correct.error) throw recentError ?? total.error ?? correct.error;

    const mastery = computeMastery(
      {
        attempts: (recent ?? []).map((a) => ({
          id: a.id,
          isCorrect: a.is_correct,
          attemptedAt: a.attempted_at,
        })),
        totalAttempts: total.count ?? 0,
        totalCorrect: correct.count ?? 0,
        masteryThreshold: skill.mastery_threshold,
        importance: skill.importance,
        now,
        timeZone,
      },
      rules.mastery,
    );
    rows.push({
      child_id: childId,
      skill_id: skill.id,
      status: mastery.status,
      mastery_score: mastery.masteryScore,
      accuracy: mastery.accuracy,
      recent_accuracy: mastery.recentAccuracy,
      attempts: mastery.attempts,
      correct_attempts: mastery.correctAttempts,
      practice_days: mastery.practiceDays,
      confidence: mastery.confidence,
      review_priority: mastery.reviewPriority,
      next_review_at: mastery.nextReviewAt?.toISOString() ?? null,
      last_practiced_at: mastery.lastPracticedAt?.toISOString() ?? null,
      updated_at: now.toISOString(),
    });
    const item = deriveSkillReviewItem(
      {
        skillId: skill.id,
        lessonId: firstLesson.get(skill.id) ?? null,
        phonicsPatternId: skill.phonics_pattern_id,
        active: skill.is_active,
        status: mastery.status,
        masteryScore: mastery.masteryScore,
        attempts: mastery.attempts,
        reviewPriority: mastery.reviewPriority,
        nextReviewAt: mastery.nextReviewAt?.toISOString() ?? null,
        recentErrors: (recent ?? []).slice(0, 5).filter((a) => !a.is_correct).length,
      },
      now,
      rules.review,
    );
    if (item) reviewRows.push(item);
  }
  if (rows.length > 0) {
    const { error: upsertError } = await db
      .from("skill_mastery")
      .upsert(rows, { onConflict: "child_id,skill_id" });
    if (upsertError) throw upsertError;
  }
  await syncReviewItems(db, childId, skillIds.map(skillKey), reviewRows, now);
}

// Upserts the open items and resolves the items in `scopeKeys` that are no longer open.
async function syncReviewItems(
  db: Db,
  childId: string,
  scopeKeys: string[],
  open: ReviewItemRow[],
  now: Date,
) {
  if (open.length > 0) {
    const { error } = await db.from("review_items").upsert(
      open.map((item) => ({ ...item, child_id: childId, updated_at: now.toISOString() })),
      { onConflict: "child_id,item_key" },
    );
    if (error) throw error;
  }
  const openKeys = new Set(open.map((i) => i.item_key));
  const resolved = scopeKeys.filter((k) => !openKeys.has(k));
  if (resolved.length > 0) {
    const { error } = await db
      .from("review_items")
      .update({ status: "done", resolved_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("child_id", childId)
      .eq("status", "open")
      .in("item_key", resolved);
    if (error) throw error;
  }
}

// Word progress (My Words), per-area progress and word review items, recomputed from all
// of the child's first tries on questions about these words. Mastery is the skill mastery
// algorithm with the vocabulary evidence target (src/lib/learning/vocabulary.ts).
async function recomputeWordProgress(
  db: Db,
  childId: string,
  wordIds: string[],
  now: Date,
  rules: LearningRules,
) {
  const [{ data: attempts, error }, { data: existing, error: existingError }, timeZone] = await Promise.all([
    db
      .from("activity_attempts")
      .select(
        "id, word_id, question_id, question_type, skill_id, lesson_id, lesson_run_id, is_correct, attempted_at",
      )
      .eq("child_id", childId)
      .eq("attempt_number", 1)
      .in("word_id", wordIds),
    db
      .from("word_progress")
      .select("word_id, is_saved, saved_source, saved_at, first_seen_at")
      .eq("child_id", childId)
      .in("word_id", wordIds),
    familyTimeZone(db, childId),
  ]);
  if (error || existingError) throw error ?? existingError;
  const wordAttempts = (attempts ?? []).filter(
    (a): a is typeof a & { word_id: string } => a.word_id !== null,
  );
  const questionIds = [...new Set(wordAttempts.map((a) => a.question_id))];
  const metadata = new Map<string, unknown>();
  if (questionIds.length > 0) {
    const { data: questions, error: questionsError } = await db
      .from("questions")
      .select("id, metadata")
      .in("id", questionIds);
    if (questionsError) throw questionsError;
    for (const q of questions ?? []) metadata.set(q.id, q.metadata);
  }
  const current = new Map((existing ?? []).map((r) => [r.word_id, r]));

  const progressRows = [];
  const areaRows = [];
  const reviewRows: ReviewItemRow[] = [];
  for (const wordId of wordIds) {
    const mine = wordAttempts
      .filter((a) => a.word_id === wordId)
      .sort((a, b) => b.attempted_at.localeCompare(a.attempted_at) || (a.id < b.id ? 1 : -1));
    if (mine.length === 0) continue;
    const progress = computeWordProgress(
      mine.map((a) => ({
        id: a.id,
        isCorrect: a.is_correct,
        attemptedAt: a.attempted_at,
        area: wordAreaFor(a.question_type, metadata.get(a.question_id)),
      })),
      { now, timeZone, rules },
    );
    const before = current.get(wordId) ?? null;
    const saved = autoSaveDecision(
      before
        ? { isSaved: before.is_saved, savedSource: before.saved_source as "auto" | "manual" | null }
        : null,
      progress.correct,
    );
    // Practice outside a lesson run (word practice, My Words, reviews) is a review.
    const lastReview = mine.find((a) => a.lesson_run_id === null)?.attempted_at ?? null;
    progressRows.push({
      child_id: childId,
      word_id: wordId,
      attempts_count: progress.attempts,
      correct_count: progress.correct,
      last_practiced_at: progress.lastPracticedAt,
      last_reviewed_at: lastReview,
      first_seen_at: before?.first_seen_at ?? mine[mine.length - 1].attempted_at,
      status: progress.status,
      mastery_score: progress.masteryScore,
      accuracy: progress.accuracy,
      practice_days: progress.practiceDays,
      review_priority: progress.reviewPriority,
      next_review_at: progress.nextReviewAt,
      is_saved: saved.isSaved,
      saved_source: saved.savedSource,
      saved_at: saved.isSaved ? (before?.saved_at ?? now.toISOString()) : null,
      updated_at: now.toISOString(),
    });
    for (const area of progress.areas)
      areaRows.push({
        child_id: childId,
        word_id: wordId,
        area: area.area,
        attempts_count: area.attempts,
        correct_count: area.correct,
        accuracy: area.accuracy,
        last_practiced_at: area.lastPracticedAt,
        updated_at: now.toISOString(),
      });
    const item = deriveWordReview(
      {
        wordId,
        skillId: mine[0].skill_id,
        lessonId: mine[0].lesson_id,
        saved: saved.isSaved,
        attempts: mine.map((a) => ({ isCorrect: a.is_correct, attemptedAt: a.attempted_at })),
        progress,
      },
      now,
      rules,
    );
    if (item) reviewRows.push(item);
  }
  if (progressRows.length > 0) {
    const { error: upsertError } = await db
      .from("word_progress")
      .upsert(progressRows, { onConflict: "child_id,word_id" });
    if (upsertError) throw upsertError;
  }
  if (areaRows.length > 0) {
    const { error: areaError } = await db
      .from("word_area_progress")
      .upsert(areaRows, { onConflict: "child_id,word_id,area" });
    if (areaError) throw areaError;
  }
  await syncReviewItems(db, childId, wordIds.map(wordKey), reviewRows, now);
}

async function recomputeSessions(db: Db, childId: string, sessionIds: string[]) {
  const [{ data: attempts, error }, { data: runs, error: runsError }] = await Promise.all([
    db
      .from("activity_attempts")
      .select(
        "question_id, activity_id, lesson_id, lesson_run_id, attempt_number, is_correct, attempted_at, learning_session_id",
      )
      .eq("child_id", childId)
      .in("learning_session_id", sessionIds)
      .limit(10000),
    db
      .from("lesson_runs")
      .select("id, lesson_id, started_at, completed_at, learning_session_id")
      .eq("child_id", childId)
      .in("learning_session_id", sessionIds),
  ]);
  if (error || runsError) throw error ?? runsError;
  const lessonIds = [
    ...new Set([
      ...(attempts ?? []).map((a) => a.lesson_id).filter((id): id is string => !!id),
      ...(runs ?? []).map((r) => r.lesson_id),
    ]),
  ];
  const structure = await loadLessonStructure(db, lessonIds);
  const activities = new Map(
    [...structure].map(([id, a]) => [
      id,
      { lessonId: a.lessonId, scoredQuestions: a.scoredQuestionIds.length },
    ]),
  );
  const rows = sessionIds.map((sessionId) =>
    deriveSession({
      sessionId,
      childId,
      attempts: ((attempts ?? []) as (AttemptFact & { learning_session_id: string | null })[]).filter(
        (a) => a.learning_session_id === sessionId,
      ),
      runs: (runs ?? []).filter((r) => r.learning_session_id === sessionId),
      activities,
    }),
  );
  // Only sessions with stored events get totals; an empty placeholder keeps its times.
  const withEvents = rows.filter((r) => r.attempts > 0 || r.lessons_completed > 0);
  if (withEvents.length > 0) {
    const { error: upsertError } = await db
      .from("learning_sessions")
      .upsert(withEvents, { onConflict: "id" });
    if (upsertError) throw upsertError;
  }
}

async function awardAchievements(db: Db, childId: string, now: Date) {
  const [achievements, earned, lessons, stars, words, runs, child] = await Promise.all([
    db.from("achievements").select("id, code, title, emoji, criteria").eq("status", "published"),
    db.from("child_achievements").select("achievement_id").eq("child_id", childId),
    db
      .from("lesson_progress")
      .select("lesson_id", { count: "exact", head: true })
      .eq("child_id", childId)
      .gt("runs_count", 0),
    db.from("reward_events").select("stars").eq("child_id", childId),
    db
      .from("word_progress")
      .select("word_id", { count: "exact", head: true })
      .eq("child_id", childId)
      .gte("correct_count", WORD_LEARNED_CORRECT_COUNT),
    db
      .from("lesson_runs")
      .select("completed_at")
      .eq("child_id", childId)
      .gte("completed_at", new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString()),
    db.from("children").select("parent_id, profiles(timezone)").eq("id", childId).maybeSingle(),
  ]);
  for (const r of [achievements, earned, lessons, stars, words, runs, child]) if (r.error) throw r.error;

  const profile = child.data
    ? Array.isArray(child.data.profiles)
      ? child.data.profiles[0]
      : child.data.profiles
    : null;
  const stats = {
    lessonsCompleted: lessons.count ?? 0,
    starsEarned: (stars.data ?? []).reduce((sum, r) => sum + r.stars, 0),
    streakDays: currentStreak(
      (runs.data ?? []).map((r) => r.completed_at),
      profile?.timezone ?? "UTC",
      now,
    ),
    wordsLearned: words.count ?? 0,
  };
  const earnedIds = new Set((earned.data ?? []).map((r) => r.achievement_id));
  const newlyEarned = (achievements.data ?? []).filter(
    (a) => !earnedIds.has(a.id) && isAchievementEarned(a.criteria, stats),
  );
  if (newlyEarned.length === 0) return [];

  const { error: insertError } = await db.from("child_achievements").upsert(
    newlyEarned.map((a) => ({ child_id: childId, achievement_id: a.id, earned_at: now.toISOString() })),
    {
      onConflict: "child_id,achievement_id",
      ignoreDuplicates: true,
    },
  );
  if (insertError) throw insertError;
  const { error: rewardError } = await db.from("reward_events").upsert(
    newlyEarned.map((a) => ({
      child_id: childId,
      source_type: "achievement",
      source_id: a.id,
      points: ACHIEVEMENT_POINTS,
      stars: 0,
    })),
    { onConflict: "child_id,source_type,source_id", ignoreDuplicates: true },
  );
  if (rewardError) throw rewardError;
  return newlyEarned.map((a) => ({ code: a.code, title: a.title, emoji: a.emoji }));
}
