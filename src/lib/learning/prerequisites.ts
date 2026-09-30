import { masteryRank, type MasteryStatus } from "@/lib/learning/mastery";
import { DEFAULT_RULES, type PrerequisiteRules } from "@/lib/learning/rules";

// Prerequisite checking. Deliberately not a hard lock: a lesson whose prerequisites are
// not ready yet is still reachable as a short preview, and the child is offered the
// prerequisite to practise first. A skill prerequisite is ready from
// rules.minStatus (default PRACTICING); a lesson prerequisite once it has been completed.
// A skill from a level below the child's current level is assumed known (the child was
// placed above it) until they practise it and show otherwise.

export type SkillPrerequisite = {
  skillId: string;
  title: string;
  // A lesson that practises it (to recommend), if one is published.
  lessonId: string | null;
  // Below the child's current level: ready unless practised and still weak.
  belowLevel?: boolean;
};

export type LessonPrerequisite = { lessonId: string; title: string };

export type PrerequisiteCheck = {
  ready: boolean;
  missingSkills: (SkillPrerequisite & { status: MasteryStatus })[];
  missingLessons: LessonPrerequisite[];
  // What to practise first, if anything.
  recommendation: { lessonId: string; title: string } | null;
  // How many steps of the lesson may be played before the prerequisites are ready
  // (null = the whole lesson).
  previewSteps: number | null;
};

export function checkPrerequisites(args: {
  skills: SkillPrerequisite[];
  lessons: LessonPrerequisite[];
  mastery: ReadonlyMap<string, MasteryStatus>;
  completedLessonIds: ReadonlySet<string>;
  rules?: PrerequisiteRules;
}): PrerequisiteCheck {
  const rules = args.rules ?? DEFAULT_RULES.prerequisites;
  const missingSkills = args.skills
    .map((s) => ({ ...s, status: args.mastery.get(s.skillId) ?? ("NOT_STARTED" as MasteryStatus) }))
    .filter((s) => !(s.belowLevel && s.status === "NOT_STARTED"))
    .filter((s) => masteryRank(s.status) < masteryRank(rules.minStatus));
  const missingLessons = args.lessons.filter((l) => !args.completedLessonIds.has(l.lessonId));
  const ready = missingSkills.length === 0 && missingLessons.length === 0;

  const skillPractice = missingSkills.find((s) => s.lessonId);
  const recommendation = missingLessons[0]
    ? { lessonId: missingLessons[0].lessonId, title: missingLessons[0].title }
    : skillPractice
      ? { lessonId: skillPractice.lessonId!, title: skillPractice.title }
      : null;

  return {
    ready,
    missingSkills,
    missingLessons,
    recommendation,
    previewSteps: ready ? null : rules.previewSteps,
  };
}
