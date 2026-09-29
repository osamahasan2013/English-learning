import "server-only";

import { isAchievementEarned } from "@/lib/learning/achievements";
import { currentStreak } from "@/lib/learning/analytics";
import { computeMastery, MASTERY_RULES } from "@/lib/learning/mastery";
import {
  aggregateLessonProgress,
  aggregateWordAttempts,
  buildAttemptRow,
  clampTimestamp,
  WORD_LEARNED_CORRECT_COUNT,
  type StoredQuestion,
} from "@/lib/learning/progress-derivation";
import { scoreLesson } from "@/lib/learning/scoring";
import type {
  AttemptEvent,
  LessonRunEvent,
  SyncEvent,
  SyncResponse,
  SyncResult,
} from "@/lib/offline/sync-protocol";
import { createAdminClient } from "@/lib/supabase/admin";

// Writes a batch of synced learning events for ONE child. The caller must already have
// verified that the signed-in parent owns `childId` (see app/api/sync/route.ts); this
// module uses the service role and trusts that check.
//
// Order: attempts → lesson runs → derived caches (lesson progress, skill mastery, words)
// → rewards and achievements. Every step is idempotent, so a retry after a partial
// failure converges on the same state.

const ACHIEVEMENT_POINTS = 20;

type Db = ReturnType<typeof createAdminClient>;

export async function processSyncBatch(
  childId: string,
  events: SyncEvent[],
  now = new Date(),
): Promise<SyncResponse> {
  const db = createAdminClient();
  const results = new Map<string, SyncResult>();

  const attempts = events.filter((e): e is AttemptEvent => e.kind === "attempt");
  const runs = events.filter((e): e is LessonRunEvent => e.kind === "lesson_run");

  const { newSkillIds, newWordIds } = await storeAttempts(db, childId, attempts, now, results);
  const newRunLessonIds = await storeLessonRuns(db, childId, runs, now, results);

  if (newRunLessonIds.size > 0) await recomputeLessonProgress(db, childId, [...newRunLessonIds]);
  if (newSkillIds.size > 0) await recomputeSkillMastery(db, childId, [...newSkillIds], now);
  if (newWordIds.size > 0) await recomputeWordProgress(db, childId, [...newWordIds]);
  const newAchievements =
    newRunLessonIds.size > 0 || newWordIds.size > 0 ? await awardAchievements(db, childId, now) : [];

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

async function storeAttempts(
  db: Db,
  childId: string,
  attempts: AttemptEvent[],
  now: Date,
  results: Map<string, SyncResult>,
) {
  const newSkillIds = new Set<string>();
  const newWordIds = new Set<string>();
  if (attempts.length === 0) return { newSkillIds, newWordIds };

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
  if (pending.length === 0) return { newSkillIds, newWordIds };

  const questionIds = [...new Set(pending.map((a) => a.questionId))];
  const { data: questionRows, error } = await db
    .from("questions")
    .select("id, skill_id, question_type, answer, version, activity_id, word_id, activities(lesson_id)")
    .in("id", questionIds);
  if (error) throw error;
  const questions = new Map<string, StoredQuestion>(
    (questionRows ?? []).map((q) => {
      const activity = Array.isArray(q.activities) ? q.activities[0] : q.activities;
      return [q.id, { ...q, lesson_id: activity?.lesson_id ?? null }];
    }),
  );

  const rows = [];
  for (const attempt of pending) {
    const question = questions.get(attempt.questionId);
    if (!question) {
      results.set(attempt.id, { id: attempt.id, status: "rejected", reason: "unknown_question" });
      continue;
    }
    const built = buildAttemptRow(question, attempt, childId, now);
    if (!built.ok) {
      results.set(attempt.id, { id: attempt.id, status: "rejected", reason: built.reason });
      continue;
    }
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
    if (row.attempt_number === 1) {
      newSkillIds.add(row.skill_id);
      if (row.word_id) newWordIds.add(row.word_id);
    }
  }
  return { newSkillIds, newWordIds };
}

async function storeLessonRuns(
  db: Db,
  childId: string,
  runs: LessonRunEvent[],
  now: Date,
  results: Map<string, SyncResult>,
) {
  const lessonIds = new Set<string>();
  if (runs.length === 0) return lessonIds;

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
      .maybeSingle();
    if (!lesson) {
      results.set(run.id, { id: run.id, status: "rejected", reason: "unknown_lesson" });
      continue;
    }
    // Score from the run's stored first tries, never from the device.
    const { data: firstTries, error } = await db
      .from("activity_attempts")
      .select("question_id, is_correct")
      .eq("child_id", childId)
      .eq("lesson_run_id", run.id)
      .eq("attempt_number", 1);
    if (error) throw error;
    const byQuestion = new Map((firstTries ?? []).map((a) => [a.question_id, a.is_correct]));
    if (byQuestion.size === 0) {
      results.set(run.id, { id: run.id, status: "rejected", reason: "no_attempts_for_run" });
      continue;
    }
    const score = scoreLesson([...byQuestion.values()].map((isCorrect) => ({ isCorrect })));
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
  }
  return lessonIds;
}

async function recomputeLessonProgress(db: Db, childId: string, lessonIds: string[]) {
  const { data: runs, error } = await db
    .from("lesson_runs")
    .select("lesson_id, score_percent, stars, completed_at")
    .eq("child_id", childId)
    .in("lesson_id", lessonIds);
  if (error) throw error;
  const rows = lessonIds.map((lessonId) => aggregateLessonProgress(childId, lessonId, runs ?? []));
  const { error: upsertError } = await db
    .from("lesson_progress")
    .upsert(rows, { onConflict: "child_id,lesson_id" });
  if (upsertError) throw upsertError;
}

async function recomputeSkillMastery(db: Db, childId: string, skillIds: string[], now: Date) {
  const { data: skills, error } = await db
    .from("skills")
    .select("id, mastery_threshold, importance")
    .in("id", skillIds);
  if (error) throw error;

  const rows = [];
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
        .select("is_correct, attempted_at")
        .eq("child_id", childId)
        .eq("skill_id", skill.id)
        .eq("attempt_number", 1)
        .order("attempted_at", { ascending: false })
        .limit(MASTERY_RULES.windowSize),
      base(),
      base().eq("is_correct", true),
    ]);
    if (recentError || total.error || correct.error) throw recentError ?? total.error ?? correct.error;

    const mastery = computeMastery({
      attempts: (recent ?? []).map((a) => ({ isCorrect: a.is_correct, attemptedAt: a.attempted_at })),
      totalAttempts: total.count ?? 0,
      totalCorrect: correct.count ?? 0,
      masteryThreshold: skill.mastery_threshold,
      importance: skill.importance,
      now,
    });
    rows.push({
      child_id: childId,
      skill_id: skill.id,
      status: mastery.status,
      mastery_score: mastery.masteryScore,
      accuracy: mastery.accuracy,
      recent_accuracy: mastery.recentAccuracy,
      attempts: mastery.attempts,
      correct: mastery.correct,
      practice_days: mastery.practiceDays,
      confidence: mastery.confidence,
      review_priority: mastery.reviewPriority,
      next_review_at: mastery.nextReviewAt?.toISOString() ?? null,
      last_practiced_at: mastery.lastPracticedAt?.toISOString() ?? null,
      updated_at: now.toISOString(),
    });
  }
  if (rows.length > 0) {
    const { error: upsertError } = await db
      .from("skill_mastery")
      .upsert(rows, { onConflict: "child_id,skill_id" });
    if (upsertError) throw upsertError;
  }
}

async function recomputeWordProgress(db: Db, childId: string, wordIds: string[]) {
  const [{ data: attempts, error }, { data: existing, error: existingError }] = await Promise.all([
    db
      .from("activity_attempts")
      .select("word_id, is_correct, attempted_at")
      .eq("child_id", childId)
      .eq("attempt_number", 1)
      .in("word_id", wordIds),
    db.from("word_progress").select("word_id").eq("child_id", childId).in("word_id", wordIds),
  ]);
  if (error || existingError) throw error ?? existingError;
  const stats = aggregateWordAttempts(
    (attempts ?? []).filter((a): a is typeof a & { word_id: string } => a.word_id !== null),
  );
  const existingIds = new Set((existing ?? []).map((r) => r.word_id));

  // New words are saved to "My Words" automatically once answered correctly; existing rows
  // only get fresh counts, so a word the parent/child removed stays removed.
  const inserts = [...stats]
    .filter(([wordId]) => !existingIds.has(wordId))
    .map(([wordId, s]) => ({
      child_id: childId,
      word_id: wordId,
      ...s,
      is_saved: s.correct_count > 0,
      saved_source: s.correct_count > 0 ? ("auto" as const) : null,
    }));
  if (inserts.length > 0) {
    const { error: insertError } = await db
      .from("word_progress")
      .upsert(inserts, { onConflict: "child_id,word_id", ignoreDuplicates: true });
    if (insertError) throw insertError;
  }
  for (const [wordId, s] of stats) {
    if (!existingIds.has(wordId)) continue;
    const { error: updateError } = await db
      .from("word_progress")
      .update({ ...s, updated_at: new Date().toISOString() })
      .eq("child_id", childId)
      .eq("word_id", wordId);
    if (updateError) throw updateError;
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
