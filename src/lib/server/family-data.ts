import "server-only";

import { cache } from "react";
import { currentStreak, dailyActivity, safeTimeZone, totalMinutes } from "@/lib/learning/analytics";
import { buildDailyPlan, type PlanLesson, type PlanReview } from "@/lib/learning/daily-plan";
import type { MasteryStatus } from "@/lib/learning/mastery";
import {
  practiceRecommendations,
  reviewCandidates,
  strongSkills,
  weakSkills,
  type SkillMasterySummary,
} from "@/lib/learning/recommendations";
import { WORD_LEARNED_CORRECT_COUNT } from "@/lib/learning/progress-derivation";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/types";

// Read models for the parent and child screens. Every query uses the signed-in parent's
// RLS-scoped client, so only their own children's data can ever be returned.

export type LevelSummary = Pick<
  Tables<"levels">,
  "id" | "code" | "name" | "short_name" | "theme_emoji" | "min_age" | "max_age" | "description"
>;

export const listPublishedLevels = cache(async (): Promise<LevelSummary[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("levels")
    .select("id, code, name, short_name, theme_emoji, min_age, max_age, description")
    .eq("status", "published")
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
});

export type ChildWithLevel = Tables<"children"> & { level: LevelSummary | null; grade: LevelSummary | null };

export const listChildren = cache(async (): Promise<ChildWithLevel[]> => {
  const supabase = await createClient();
  const [{ data, error }, levels] = await Promise.all([
    supabase.from("children").select("*").order("created_at"),
    listPublishedLevels(),
  ]);
  if (error) throw error;
  const byId = new Map(levels.map((l) => [l.id, l]));
  return (data ?? []).map((c) => ({
    ...c,
    level: byId.get(c.current_level_id) ?? null,
    grade: byId.get(c.grade_level_id) ?? null,
  }));
});

export type SkillProgress = SkillMasterySummary & {
  childTitle: string;
  dimension: string;
  subject: string;
  accuracy: number;
  lastPracticedAt: string | null;
};

async function loadSkillProgress(childId: string): Promise<SkillProgress[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("skill_mastery")
    .select(
      "skill_id, status, mastery_score, accuracy, attempts, review_priority, next_review_at, last_practiced_at, skills(title, child_title, dimension_code, units(subjects(name)))",
    )
    .eq("child_id", childId);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const skill = one(row.skills);
    const unit = one(skill?.units);
    const subject = one(unit?.subjects);
    return {
      skillId: row.skill_id,
      title: skill?.title ?? "Skill",
      childTitle: skill?.child_title || skill?.title || "Skill",
      dimension: skill?.dimension_code ?? "",
      subject: subject?.name ?? "",
      status: row.status as MasteryStatus,
      masteryScore: Number(row.mastery_score),
      accuracy: Number(row.accuracy),
      attempts: row.attempts,
      reviewPriority: Number(row.review_priority),
      nextReviewAt: row.next_review_at,
      lastPracticedAt: row.last_practiced_at,
    };
  });
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export type ChildProgress = Awaited<ReturnType<typeof loadChildProgress>>;

// Everything the parent dashboard shows for one child.
export async function loadChildProgress(
  childId: string,
  timeZone: string,
  now = new Date(),
  levelId: string | null = null,
) {
  const supabase = await createClient();
  const tz = safeTimeZone(timeZone);
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since400 = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString();

  const [runs, runDates, lessonsDone, rewards, wordsSaved, wordsLearned, achievements, results, skills] =
    await Promise.all([
      supabase
        .from("lesson_runs")
        .select(
          "id, lesson_id, completed_at, duration_seconds, score_percent, stars, correct_count, total_questions, lessons(title, emoji)",
        )
        .eq("child_id", childId)
        .gte("completed_at", since30)
        .order("completed_at", { ascending: false }),
      supabase
        .from("lesson_runs")
        .select("completed_at")
        .eq("child_id", childId)
        .gte("completed_at", since400),
      supabase
        .from("lesson_progress")
        .select("lesson_id", { count: "exact", head: true })
        .eq("child_id", childId)
        .gt("runs_count", 0),
      supabase.from("reward_events").select("points, stars").eq("child_id", childId),
      supabase
        .from("word_progress")
        .select("word_id", { count: "exact", head: true })
        .eq("child_id", childId)
        .eq("is_saved", true),
      supabase
        .from("word_progress")
        .select("word_id", { count: "exact", head: true })
        .eq("child_id", childId)
        .gte("correct_count", WORD_LEARNED_CORRECT_COUNT),
      supabase
        .from("child_achievements")
        .select("earned_at, achievements(code, title, emoji, description)")
        .eq("child_id", childId)
        .order("earned_at"),
      supabase
        .from("assessment_results")
        .select("id, overall_score, created_at, suggested_level_id")
        .eq("child_id", childId)
        .order("created_at"),
      loadSkillProgress(childId),
    ]);
  for (const r of [runs, runDates, lessonsDone, rewards, wordsSaved, wordsLearned, achievements, results])
    if (r.error) throw r.error;
  const engine = await loadEngineProgress(childId, levelId);

  const runSummaries = (runs.data ?? []).map((r) => ({
    completedAt: r.completed_at,
    durationSeconds: r.duration_seconds,
    scorePercent: Number(r.score_percent),
  }));
  const last14 = dailyActivity(runSummaries, 14, tz, now);
  const last30 = dailyActivity(runSummaries, 30, tz, now);

  // Accuracy by area: attempts-weighted across the child's skills in each dimension.
  const byDimension = new Map<string, { attempts: number; correctWeighted: number }>();
  for (const s of skills) {
    const entry = byDimension.get(s.dimension) ?? { attempts: 0, correctWeighted: 0 };
    entry.attempts += s.attempts;
    entry.correctWeighted += (s.accuracy / 100) * s.attempts;
    byDimension.set(s.dimension, entry);
  }

  return {
    activity14: last14,
    minutesThisWeek: totalMinutes(last14.slice(-7)),
    minutesThisMonth: totalMinutes(last30),
    activeDaysThisWeek: last14.slice(-7).filter((d) => d.lessons > 0).length,
    streak: currentStreak(
      (runDates.data ?? []).map((r) => r.completed_at),
      tz,
      now,
    ),
    lessonsCompleted: lessonsDone.count ?? 0,
    ...engine,
    stars: (rewards.data ?? []).reduce((sum, r) => sum + r.stars, 0),
    points: (rewards.data ?? []).reduce((sum, r) => sum + r.points, 0),
    wordsSaved: wordsSaved.count ?? 0,
    wordsLearned: wordsLearned.count ?? 0,
    recentRuns: (runs.data ?? []).slice(0, 8).map((r) => {
      const lesson = one(r.lessons);
      return {
        id: r.id,
        title: lesson?.title ?? "Lesson",
        emoji: lesson?.emoji ?? "",
        completedAt: r.completed_at,
        scorePercent: Number(r.score_percent),
        stars: r.stars,
        correct: r.correct_count,
        total: r.total_questions,
      };
    }),
    skills: [...skills].sort((a, b) => (b.lastPracticedAt ?? "").localeCompare(a.lastPracticedAt ?? "")),
    weak: weakSkills(skills),
    strong: strongSkills(skills),
    recommendations: practiceRecommendations(skills),
    accuracyByDimension: [...byDimension]
      .filter(([, v]) => v.attempts > 0)
      .map(([dimension, v]) => ({
        dimension,
        attempts: v.attempts,
        accuracy: Math.round((100 * v.correctWeighted) / v.attempts),
      })),
    achievements: (achievements.data ?? []).flatMap((a) => {
      const achievement = one(a.achievements);
      return achievement ? [{ ...achievement, earnedAt: a.earned_at }] : [];
    }),
    assessmentResults: results.data ?? [],
  };
}

export type SubjectProgressSummary = {
  subjectId: string;
  name: string;
  emoji: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  lessonsCompleted: number;
  lessonsTotal: number;
  accuracy: number;
  score: number;
};

// Progress-engine totals for one child: activities completed, average lesson score,
// learning time from sessions, and subject/level progress for a level (default: the
// child's current level). Subjects without stored progress yet are listed at zero.
export async function loadEngineProgress(childId: string, levelId: string | null = null) {
  const supabase = await createClient();
  const level =
    levelId ??
    (await supabase.from("children").select("current_level_id").eq("id", childId).maybeSingle()).data
      ?.current_level_id ??
    null;
  const [activitiesDone, scores, sessions, subjects, levelRow, catalog] = await Promise.all([
    supabase
      .from("activity_progress")
      .select("activity_id", { count: "exact", head: true })
      .eq("child_id", childId)
      .eq("status", "COMPLETED"),
    supabase.from("lesson_runs").select("score_percent").eq("child_id", childId),
    supabase.from("learning_sessions").select("duration_seconds, attempts").eq("child_id", childId),
    level
      ? supabase
          .from("subject_progress")
          .select("subject_id, status, lessons_completed, lessons_total, accuracy, score")
          .eq("child_id", childId)
          .eq("level_id", level)
      : Promise.resolve({ data: [], error: null }),
    level
      ? supabase
          .from("level_progress")
          .select("status, lessons_completed, lessons_total, skills_mastered, skills_total, accuracy, score")
          .eq("child_id", childId)
          .eq("level_id", level)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    level
      ? supabase
          .from("lesson_catalog")
          .select("lesson_id, skill_id, subject_id, subject_name, subject_emoji, subject_order")
          .eq("level_id", level)
          .eq("skill_active", true)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [activitiesDone, scores, sessions, subjects, levelRow, catalog]) if (r.error) throw r.error;

  const stored = new Map((subjects.data ?? []).map((r) => [r.subject_id, r]));
  const bySubject = new Map<string, SubjectProgressSummary & { order: number }>();
  for (const l of catalog.data ?? []) {
    if (!l.subject_id) continue;
    const entry = bySubject.get(l.subject_id) ?? {
      subjectId: l.subject_id,
      name: l.subject_name ?? "",
      emoji: l.subject_emoji ?? "",
      order: l.subject_order ?? 0,
      status: "NOT_STARTED" as const,
      lessonsCompleted: 0,
      lessonsTotal: 0,
      accuracy: 0,
      score: 0,
    };
    entry.lessonsTotal++;
    bySubject.set(l.subject_id, entry);
  }
  for (const entry of bySubject.values()) {
    const row = stored.get(entry.subjectId);
    if (!row) continue;
    entry.status = row.status;
    entry.lessonsCompleted = row.lessons_completed;
    entry.accuracy = Number(row.accuracy);
    entry.score = Number(row.score);
  }
  const runScores = (scores.data ?? []).map((r) => Number(r.score_percent));
  const learningSeconds = (sessions.data ?? []).reduce((n, r) => n + r.duration_seconds, 0);
  const lessonsTotal = (catalog.data ?? []).length;
  return {
    activitiesCompleted: activitiesDone.count ?? 0,
    averageScore: runScores.length ? Math.round(runScores.reduce((a, b) => a + b, 0) / runScores.length) : 0,
    learningMinutes: Math.round(learningSeconds / 60),
    sessionsCount: (sessions.data ?? []).length,
    subjectProgress: [...bySubject.values()].sort((a, b) => a.order - b.order),
    levelProgress: {
      lessonsCompleted: levelRow.data?.lessons_completed ?? 0,
      lessonsTotal: levelRow.data?.lessons_total ?? lessonsTotal,
      skillsMastered: levelRow.data?.skills_mastered ?? 0,
      skillsTotal: levelRow.data?.skills_total ?? new Set((catalog.data ?? []).map((l) => l.skill_id)).size,
      accuracy: Number(levelRow.data?.accuracy ?? 0),
      score: Number(levelRow.data?.score ?? 0),
    },
  };
}

export type PathLesson = {
  id: string;
  title: string;
  emoji: string;
  minutes: number;
  skillId: string;
  unitTitle: string;
  subjectName: string;
  subjectEmoji: string;
  completed: boolean;
  bestStars: number;
};

export type PathUnit = {
  id: string;
  title: string;
  emoji: string;
  subjectName: string;
  lessons: PathLesson[];
};

// The child's learning path for their current level, today's plan and reward totals.
export async function loadChildHome(child: Tables<"children">, now = new Date()) {
  const supabase = await createClient();
  const { data: units, error } = await supabase
    .from("units")
    .select("id, title, emoji, sort_order, subjects(name, emoji)")
    .eq("level_id", child.current_level_id)
    .eq("status", "published")
    .order("sort_order");
  if (error) throw error;
  const unitIds = (units ?? []).map((u) => u.id);

  const { data: skills } = unitIds.length
    ? await supabase
        .from("skills")
        .select("id, unit_id, title, child_title, sort_order")
        .in("unit_id", unitIds)
        .eq("status", "published")
        .order("sort_order")
    : { data: [] };
  const skillIds = (skills ?? []).map((s) => s.id);

  const [lessons, progress, rewards, mastery, recent] = await Promise.all([
    skillIds.length
      ? supabase
          .from("lessons")
          .select("id, skill_id, title, child_title, emoji, estimated_minutes, sort_order")
          .in("skill_id", skillIds)
          .eq("status", "published")
          .order("sort_order")
      : Promise.resolve({ data: [] as never[], error: null }),
    supabase.from("lesson_progress").select("lesson_id, runs_count, best_stars").eq("child_id", child.id),
    supabase.from("reward_events").select("stars, points").eq("child_id", child.id),
    loadSkillProgress(child.id),
    supabase
      .from("lesson_runs")
      .select("id, lesson_id, stars, score_percent, completed_at, lessons(title, child_title, emoji)")
      .eq("child_id", child.id)
      .order("completed_at", { ascending: false })
      .limit(3),
  ]);
  for (const r of [lessons, progress, rewards, recent]) if (r.error) throw r.error;

  const progressByLesson = new Map((progress.data ?? []).map((p) => [p.lesson_id, p]));
  const path: PathUnit[] = (units ?? []).map((unit) => {
    const subject = one(unit.subjects);
    const unitSkills = (skills ?? []).filter((s) => s.unit_id === unit.id);
    return {
      id: unit.id,
      title: unit.title,
      emoji: unit.emoji,
      subjectName: subject?.name ?? "",
      lessons: unitSkills.flatMap((skill) =>
        (lessons.data ?? [])
          .filter((l) => l.skill_id === skill.id)
          .map((l) => {
            const p = progressByLesson.get(l.id);
            return {
              id: l.id,
              title: l.child_title || l.title,
              emoji: l.emoji,
              minutes: l.estimated_minutes,
              skillId: skill.id,
              unitTitle: unit.title,
              subjectName: subject?.name ?? "",
              subjectEmoji: subject?.emoji ?? "",
              completed: (p?.runs_count ?? 0) > 0,
              bestStars: p?.best_stars ?? 0,
            };
          }),
      ),
    };
  });

  const allLessons = path.flatMap((u) => u.lessons);
  const nextLessons: PlanLesson[] = allLessons
    .filter((l) => !l.completed)
    .map((l) => ({
      lessonId: l.id,
      title: l.title,
      subjectName: l.subjectName,
      estimatedMinutes: l.minutes,
    }));

  // Review a due or weak skill by replaying its first lesson (V1; see docs/curriculum.md).
  const candidates = reviewCandidates(mastery, now);
  const reviewLessonBySkill = new Map<string, PathLesson>();
  for (const lesson of allLessons)
    if (!reviewLessonBySkill.has(lesson.skillId)) reviewLessonBySkill.set(lesson.skillId, lesson);
  const missingSkillIds = candidates.map((c) => c.skillId).filter((id) => !reviewLessonBySkill.has(id));
  const otherLessons = missingSkillIds.length
    ? ((
        await supabase
          .from("lessons")
          .select("id, skill_id, title, child_title")
          .in("skill_id", missingSkillIds)
          .eq("status", "published")
          .order("sort_order")
      ).data ?? [])
    : [];
  const reviews: PlanReview[] = candidates.flatMap((c) => {
    const lesson = reviewLessonBySkill.get(c.skillId);
    if (lesson)
      return [
        { skillId: c.skillId, title: c.childTitle, lessonId: lesson.id, subjectName: lesson.subjectName },
      ];
    const other = otherLessons.find((l) => l.skill_id === c.skillId);
    return other
      ? [{ skillId: c.skillId, title: c.childTitle, lessonId: other.id, subjectName: c.subject }]
      : [];
  });

  const plan = buildDailyPlan({ dailyMinutes: child.daily_minutes, nextLessons, reviews });
  return {
    path,
    plan,
    stars: (rewards.data ?? []).reduce((sum, r) => sum + r.stars, 0),
    points: (rewards.data ?? []).reduce((sum, r) => sum + r.points, 0),
    lessonsCompleted: allLessons.filter((l) => l.completed).length,
    lessonsTotal: allLessons.length,
    recentLessons: (recent.data ?? []).map((r) => {
      const lesson = one(r.lessons);
      return {
        id: r.id,
        lessonId: r.lesson_id,
        title: lesson?.child_title || lesson?.title || "Lesson",
        emoji: lesson?.emoji ?? "",
        stars: r.stars,
        completedAt: r.completed_at,
      };
    }),
    // The skills of this level with the child's mastery (not started when never practised).
    skills: (skills ?? []).map((skill) => {
      const m = mastery.find((x) => x.skillId === skill.id);
      return {
        id: skill.id,
        title: skill.child_title || skill.title,
        status: m?.status ?? ("NOT_STARTED" as MasteryStatus),
        masteryScore: m?.masteryScore ?? 0,
      };
    }),
  };
}

export async function loadChildRewards(childId: string) {
  const supabase = await createClient();
  const [all, earned, rewards] = await Promise.all([
    supabase
      .from("achievements")
      .select("id, code, title, description, emoji, sort_order")
      .eq("status", "published")
      .order("sort_order"),
    supabase.from("child_achievements").select("achievement_id, earned_at").eq("child_id", childId),
    supabase.from("reward_events").select("stars, points").eq("child_id", childId),
  ]);
  for (const r of [all, earned, rewards]) if (r.error) throw r.error;
  const earnedAt = new Map((earned.data ?? []).map((e) => [e.achievement_id, e.earned_at]));
  return {
    stars: (rewards.data ?? []).reduce((sum, r) => sum + r.stars, 0),
    points: (rewards.data ?? []).reduce((sum, r) => sum + r.points, 0),
    achievements: (all.data ?? []).map((a) => ({ ...a, earnedAt: earnedAt.get(a.id) ?? null })),
  };
}

export const listDimensionNames = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("skill_dimensions").select("code, name");
  return new Map((data ?? []).map((d) => [d.code, d.name]));
});
