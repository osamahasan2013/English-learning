import "server-only";

import { cache } from "react";
import {
  getNextLesson as pickNextLesson,
  getRecommendedLessons as pickRecommendedLessons,
  lessonPrerequisiteCheck,
  type CatalogLesson,
  type EngineInput,
  type LessonState,
} from "@/lib/learning/engine";
import type { MasteryStatus } from "@/lib/learning/mastery";
import { weakSkills, type SkillMasterySummary } from "@/lib/learning/recommendations";
import { dueReviewItems, type ReviewItemSummary, type ReviewReason } from "@/lib/learning/review-queue";
import { loadLearningRules } from "@/lib/server/learning-rules";
import { createClient } from "@/lib/supabase/server";

// The learning engine's service interface. Every function takes a child id from the
// caller and first loads that child with the signed-in parent's RLS client: a child that
// is not theirs is simply not found (and every other query is RLS-scoped as well), so no
// function can reveal another family's data whatever id it is given.

export class ChildNotFoundError extends Error {
  constructor() {
    super("CHILD_NOT_FOUND");
  }
}

// Everything the engine rules need for one child, loaded once per request.
export const loadEngineInput = cache(async (childId: string, now = new Date()): Promise<EngineInput> => {
  if (!/^[0-9a-f-]{36}$/i.test(childId)) throw new ChildNotFoundError();
  const supabase = await createClient();
  const { data: child } = await supabase
    .from("children")
    .select("id, current_level_id")
    .eq("id", childId)
    .maybeSingle();
  if (!child) throw new ChildNotFoundError();

  const [catalog, lessonProgress, mastery, reviewRows, rules] = await Promise.all([
    supabase
      .from("lesson_catalog")
      .select(
        "lesson_id, lesson_title, lesson_child_title, lesson_emoji, estimated_minutes, skill_id, skill_title, skill_child_title, skill_active, subject_id, subject_name, level_id, unit_order, skill_order, lesson_order",
      )
      .eq("level_id", child.current_level_id)
      .order("unit_order")
      .order("skill_order")
      .order("lesson_order"),
    supabase.from("lesson_progress").select("lesson_id, status, best_stars").eq("child_id", child.id),
    supabase.from("skill_mastery").select("skill_id, status").eq("child_id", child.id),
    supabase
      .from("review_items")
      .select(
        "item_key, skill_id, word_id, lesson_id, priority, due_at, reason, status, lessons(title, child_title)",
      )
      .eq("child_id", child.id)
      .eq("status", "open")
      .order("priority", { ascending: false })
      .limit(50),
    loadLearningRules(supabase),
  ]);
  for (const r of [catalog, lessonProgress, mastery, reviewRows]) if (r.error) throw r.error;

  const path: CatalogLesson[] = (catalog.data ?? []).map((l) => ({
    lessonId: l.lesson_id!,
    title: l.lesson_child_title || l.lesson_title || "",
    emoji: l.lesson_emoji ?? "",
    estimatedMinutes: l.estimated_minutes ?? 5,
    skillId: l.skill_id!,
    skillTitle: l.skill_child_title || l.skill_title || "",
    skillActive: l.skill_active ?? true,
    subjectId: l.subject_id!,
    subjectName: l.subject_name ?? "",
    levelId: l.level_id!,
  }));

  const prerequisites = await loadPrerequisites(path);
  return {
    path,
    lessonStates: new Map(
      (lessonProgress.data ?? []).map((p): [string, LessonState] => [
        p.lesson_id,
        { status: p.status, bestStars: p.best_stars },
      ]),
    ),
    mastery: new Map((mastery.data ?? []).map((m): [string, MasteryStatus] => [m.skill_id, m.status])),
    prerequisites,
    reviewItems: (reviewRows.data ?? []).map((r) => {
      const lesson = Array.isArray(r.lessons) ? r.lessons[0] : r.lessons;
      return {
        itemKey: r.item_key,
        skillId: r.skill_id,
        wordId: r.word_id,
        lessonId: r.lesson_id,
        priority: Number(r.priority),
        dueAt: r.due_at,
        reason: r.reason as ReviewReason,
        status: r.status as "open",
        lessonTitle: lesson ? lesson.child_title || lesson.title : undefined,
      };
    }),
    rules,
    now,
  };
});

async function loadPrerequisites(path: CatalogLesson[]) {
  const supabase = await createClient();
  type Prerequisites = EngineInput["prerequisites"] extends ReadonlyMap<string, infer V> ? V : never;
  const out = new Map<string, Prerequisites>();
  if (path.length === 0) return out;
  const lessonIds = path.map((l) => l.lessonId);
  const skillIds = [...new Set(path.map((l) => l.skillId))];
  const [skillLinks, lessonLinks] = await Promise.all([
    supabase
      .from("skill_prerequisites")
      .select(
        "skill_id, prerequisite_skill_id, skills!skill_prerequisites_prerequisite_skill_id_fkey(title, child_title)",
      )
      .in("skill_id", skillIds),
    supabase
      .from("lesson_prerequisites")
      .select(
        "lesson_id, prerequisite_lesson_id, lessons!lesson_prerequisites_prerequisite_lesson_id_fkey(title, child_title)",
      )
      .in("lesson_id", lessonIds),
  ]);
  if (skillLinks.error || lessonLinks.error) throw skillLinks.error ?? lessonLinks.error;
  const prereqSkillIds = [...new Set((skillLinks.data ?? []).map((l) => l.prerequisite_skill_id))];
  const practice = new Map<string, string>();
  const skillLevelOrder = new Map<string, number>();
  const currentLevelOrder = new Map<string, number>();
  const { data: levelRows } = await supabase
    .from("lesson_catalog")
    .select("lesson_id, level_order")
    .in("lesson_id", lessonIds);
  for (const row of levelRows ?? [])
    if (row.lesson_id) currentLevelOrder.set(row.lesson_id, row.level_order ?? 0);
  if (prereqSkillIds.length > 0) {
    const { data } = await supabase
      .from("lesson_catalog")
      .select("lesson_id, skill_id, lesson_order, level_order")
      .in("skill_id", prereqSkillIds)
      .order("lesson_order");
    for (const row of data ?? []) {
      if (!row.skill_id) continue;
      if (!practice.has(row.skill_id)) practice.set(row.skill_id, row.lesson_id!);
      skillLevelOrder.set(row.skill_id, row.level_order ?? 0);
    }
  }
  for (const lesson of path) {
    out.set(lesson.lessonId, {
      skills: (skillLinks.data ?? [])
        .filter((l) => l.skill_id === lesson.skillId)
        .map((l) => {
          const s = Array.isArray(l.skills) ? l.skills[0] : l.skills;
          return {
            skillId: l.prerequisite_skill_id,
            title: s?.child_title || s?.title || "",
            lessonId: practice.get(l.prerequisite_skill_id) ?? null,
            belowLevel:
              (skillLevelOrder.get(l.prerequisite_skill_id) ?? Infinity) <
              (currentLevelOrder.get(lesson.lessonId) ?? 0),
          };
        }),
      lessons: (lessonLinks.data ?? [])
        .filter((l) => l.lesson_id === lesson.lessonId)
        .map((l) => {
          const p = Array.isArray(l.lessons) ? l.lessons[0] : l.lessons;
          return { lessonId: l.prerequisite_lesson_id, title: p?.child_title || p?.title || "" };
        }),
    });
  }
  return out;
}

export async function getNextLesson(childId: string) {
  return pickNextLesson(await loadEngineInput(childId));
}

export async function getRecommendedLessons(childId: string, limit = 4) {
  return pickRecommendedLessons(await loadEngineInput(childId), limit);
}

export async function getReviewItems(childId: string, limit = 10): Promise<ReviewItemSummary[]> {
  const input = await loadEngineInput(childId);
  return dueReviewItems(input.reviewItems, input.now, limit);
}

export type WeakSkill = SkillMasterySummary & { accuracy: number };

export async function getWeakSkills(childId: string): Promise<WeakSkill[]> {
  const input = await loadEngineInput(childId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("skill_mastery")
    .select(
      "skill_id, status, mastery_score, accuracy, attempts, review_priority, next_review_at, skills(title, child_title, is_active)",
    )
    .eq("child_id", childId);
  if (error) throw error;
  const skills = (data ?? [])
    .map((row) => {
      const skill = Array.isArray(row.skills) ? row.skills[0] : row.skills;
      return {
        skillId: row.skill_id,
        title: skill?.child_title || skill?.title || "",
        active: skill?.is_active ?? true,
        status: row.status,
        masteryScore: Number(row.mastery_score),
        accuracy: Number(row.accuracy),
        attempts: row.attempts,
        reviewPriority: Number(row.review_priority),
        nextReviewAt: row.next_review_at,
      };
    })
    .filter((s) => s.active);
  return weakSkills(skills, input.rules!.review);
}

// Whether the child is ready for a lesson (for the lesson page).
export async function getLessonReadiness(childId: string, lessonId: string) {
  const input = await loadEngineInput(childId);
  if (!input.prerequisites.has(lessonId)) {
    // Not on the child's current level: load its prerequisites on their own.
    const supabase = await createClient();
    const { data } = await supabase
      .from("lesson_catalog")
      .select(
        "lesson_id, lesson_title, lesson_child_title, lesson_emoji, estimated_minutes, skill_id, skill_title, skill_child_title, skill_active, subject_id, subject_name, level_id",
      )
      .eq("lesson_id", lessonId)
      .maybeSingle();
    if (!data) return null;
    const extra = await loadPrerequisites([
      {
        lessonId,
        title: data.lesson_child_title || data.lesson_title || "",
        emoji: data.lesson_emoji ?? "",
        estimatedMinutes: data.estimated_minutes ?? 5,
        skillId: data.skill_id!,
        skillTitle: data.skill_child_title || data.skill_title || "",
        skillActive: data.skill_active ?? true,
        subjectId: data.subject_id!,
        subjectName: data.subject_name ?? "",
        levelId: data.level_id!,
      },
    ]);
    return lessonPrerequisiteCheck({ ...input, prerequisites: extra }, lessonId);
  }
  return lessonPrerequisiteCheck(input, lessonId);
}
