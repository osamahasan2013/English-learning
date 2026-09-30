import type { MasteryStatus } from "@/lib/learning/mastery";
import { checkPrerequisites, type PrerequisiteCheck } from "@/lib/learning/prerequisites";
import { dueReviewItems, type ReviewItemSummary } from "@/lib/learning/review-queue";
import { DEFAULT_RULES, type LearningRules } from "@/lib/learning/rules";

// Rule-based lesson selection (pure; loaded and called by src/lib/server/learning-engine.ts):
//   next lesson     = the first lesson on the child's level path (unit → skill → lesson
//                     order) that is not completed and whose prerequisites are ready;
//                     if none is ready, the first not completed (played as a preview).
//   recommendations = continue a started lesson, then the next lesson, then review of
//                     due items, then practice for a missing prerequisite.
// Every choice carries a reason a parent could be shown.

export type CatalogLesson = {
  lessonId: string;
  title: string;
  emoji: string;
  estimatedMinutes: number;
  skillId: string;
  skillTitle: string;
  skillActive: boolean;
  subjectId: string;
  subjectName: string;
  levelId: string;
};

export type LessonState = { status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED"; bestStars: number };

export type EngineInput = {
  // Lessons of the child's current level, in path order.
  path: CatalogLesson[];
  lessonStates: ReadonlyMap<string, LessonState>;
  mastery: ReadonlyMap<string, MasteryStatus>;
  // Prerequisites per lesson: skills (via the lesson's skill) and lessons.
  prerequisites: ReadonlyMap<
    string,
    {
      skills: { skillId: string; title: string; lessonId: string | null; belowLevel?: boolean }[];
      lessons: { lessonId: string; title: string }[];
    }
  >;
  reviewItems: (ReviewItemSummary & { lessonTitle?: string })[];
  rules?: LearningRules;
  now: Date;
};

export type RecommendationReason = "continue" | "next" | "review" | "prerequisite";

export type Recommendation = {
  lessonId: string;
  title: string;
  emoji: string;
  subjectName: string;
  reason: RecommendationReason;
  prerequisites: PrerequisiteCheck;
};

const completedIds = (states: EngineInput["lessonStates"]) =>
  new Set([...states].filter(([, s]) => s.status === "COMPLETED").map(([id]) => id));

export function lessonPrerequisiteCheck(input: EngineInput, lessonId: string): PrerequisiteCheck {
  const p = input.prerequisites.get(lessonId) ?? { skills: [], lessons: [] };
  return checkPrerequisites({
    skills: p.skills,
    lessons: p.lessons,
    mastery: input.mastery,
    completedLessonIds: completedIds(input.lessonStates),
    rules: (input.rules ?? DEFAULT_RULES).prerequisites,
  });
}

export function getNextLesson(input: EngineInput): Recommendation | null {
  const open = input.path.filter(
    (l) => l.skillActive && input.lessonStates.get(l.lessonId)?.status !== "COMPLETED",
  );
  if (open.length === 0) return null;
  const checked = open.map((l) => ({ lesson: l, check: lessonPrerequisiteCheck(input, l.lessonId) }));
  const pick = checked.find((c) => c.check.ready) ?? checked[0];
  return toRecommendation(pick.lesson, "next", pick.check);
}

export function getRecommendedLessons(input: EngineInput, limit = 4): Recommendation[] {
  const byId = new Map(input.path.map((l) => [l.lessonId, l]));
  const out: Recommendation[] = [];
  const add = (lessonId: string, reason: RecommendationReason, fallback?: { title: string }) => {
    if (out.some((r) => r.lessonId === lessonId)) return;
    const lesson = byId.get(lessonId);
    if (!lesson && !fallback) return;
    out.push(
      toRecommendation(
        lesson ?? {
          lessonId,
          title: fallback!.title,
          emoji: "",
          estimatedMinutes: 5,
          skillId: "",
          skillTitle: "",
          skillActive: true,
          subjectId: "",
          subjectName: "",
          levelId: "",
        },
        reason,
        lessonPrerequisiteCheck(input, lessonId),
      ),
    );
  };

  for (const lesson of input.path) {
    if (lesson.skillActive && input.lessonStates.get(lesson.lessonId)?.status === "IN_PROGRESS")
      add(lesson.lessonId, "continue");
  }
  const next = getNextLesson(input);
  if (next) {
    // Not ready yet: practise the missing prerequisite first, then the lesson itself.
    if (!next.prerequisites.ready && next.prerequisites.recommendation) {
      add(next.prerequisites.recommendation.lessonId, "prerequisite", next.prerequisites.recommendation);
    }
    add(next.lessonId, "next");
  }
  for (const item of dueReviewItems(input.reviewItems, input.now)) {
    if (item.lessonId)
      add(item.lessonId, "review", item.lessonTitle ? { title: item.lessonTitle } : undefined);
  }
  return out.slice(0, limit);
}

function toRecommendation(
  lesson: CatalogLesson,
  reason: RecommendationReason,
  prerequisites: PrerequisiteCheck,
): Recommendation {
  return {
    lessonId: lesson.lessonId,
    title: lesson.title,
    emoji: lesson.emoji,
    subjectName: lesson.subjectName,
    reason,
    prerequisites,
  };
}
