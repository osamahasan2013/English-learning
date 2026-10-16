import type { MasteryStatus } from "@/lib/learning/mastery";
import { checkPrerequisites, type PrerequisiteCheck } from "@/lib/learning/prerequisites";
import type { ReviewItemSummary } from "@/lib/learning/review-queue";
import { DEFAULT_RULES, type LearningRules } from "@/lib/learning/rules";

// Rule-based lesson path (pure; loaded and called by src/lib/server/learning-engine.ts):
//   next lesson = the first lesson on the child's level path (unit → skill → lesson order)
//                 that is not completed and whose prerequisites are ready; if none is
//                 ready, the first not completed (played as a preview).
// Lesson prerequisite checks also live here. What a child should do next across domains
// (continue, repair, review, re-check, stretch) is decided by ONE engine only:
// src/lib/learning/adaptive.ts (ADR-048).

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
