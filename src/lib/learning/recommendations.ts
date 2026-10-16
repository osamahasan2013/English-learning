import type { MasteryStatus } from "@/lib/learning/mastery";
import { DEFAULT_RULES, type ReviewRules } from "@/lib/learning/rules";

// Skill summaries from stored mastery: which skills are weak or going well, and which to
// bring back in review. Recommendations (what to do next) come only from the adaptive
// engine (src/lib/learning/adaptive.ts, ADR-048).

export type SkillMasterySummary = {
  skillId: string;
  title: string;
  status: MasteryStatus;
  masteryScore: number;
  attempts: number;
  reviewPriority: number;
  nextReviewAt: string | null;
};

// Weak = enough evidence (review rules: minAttempts) and a score below weakBelowScore.
export function weakSkills<T extends SkillMasterySummary>(
  skills: T[],
  rules: ReviewRules = DEFAULT_RULES.review,
): T[] {
  return skills
    .filter((s) => s.attempts >= rules.minAttempts && s.masteryScore < rules.weakBelowScore)
    .sort((a, b) => b.reviewPriority - a.reviewPriority || a.masteryScore - b.masteryScore);
}

export function strongSkills<T extends SkillMasterySummary>(skills: T[]): T[] {
  return skills
    .filter((s) => s.status === "MASTERED" || s.status === "ALMOST_MASTERED")
    .sort((a, b) => b.masteryScore - a.masteryScore);
}

// Skills to bring back in review: weak ones first, then anything due, highest priority
// first. Mastered skills still appear once due, so they are revisited periodically.
export function reviewCandidates<T extends SkillMasterySummary>(
  skills: T[],
  now: Date,
  rules: ReviewRules = DEFAULT_RULES.review,
): T[] {
  const weakIds = new Set(weakSkills(skills, rules).map((s) => s.skillId));
  return skills
    .filter((s) => s.status !== "NOT_STARTED")
    .filter((s) => weakIds.has(s.skillId) || (s.nextReviewAt !== null && new Date(s.nextReviewAt) <= now))
    .sort(
      (a, b) =>
        Number(weakIds.has(b.skillId)) - Number(weakIds.has(a.skillId)) ||
        b.reviewPriority - a.reviewPriority,
    );
}
