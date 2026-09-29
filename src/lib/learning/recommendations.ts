import type { MasteryStatus } from "@/lib/learning/mastery";

// Turns stored skill mastery into the parent's "what is difficult / what to practise next"
// and the child's review choices. Rule-based and explainable (docs/curriculum.md).

export const RECOMMENDATION_RULES = {
  // A skill needs this much evidence before it is called weak or strong.
  minAttempts: 4,
  weakBelowScore: 70,
  maxRecommendations: 3,
} as const;

export type SkillMasterySummary = {
  skillId: string;
  title: string;
  status: MasteryStatus;
  masteryScore: number;
  attempts: number;
  reviewPriority: number;
  nextReviewAt: string | null;
};

export function weakSkills<T extends SkillMasterySummary>(skills: T[]): T[] {
  return skills
    .filter(
      (s) =>
        s.attempts >= RECOMMENDATION_RULES.minAttempts &&
        s.masteryScore < RECOMMENDATION_RULES.weakBelowScore,
    )
    .sort((a, b) => b.reviewPriority - a.reviewPriority || a.masteryScore - b.masteryScore);
}

export function strongSkills<T extends SkillMasterySummary>(skills: T[]): T[] {
  return skills
    .filter((s) => s.status === "MASTERED" || s.status === "ALMOST_MASTERED")
    .sort((a, b) => b.masteryScore - a.masteryScore);
}

// Skills to bring back in review: weak ones first, then anything due, highest priority
// first. Mastered skills still appear once due, so they are revisited periodically.
export function reviewCandidates<T extends SkillMasterySummary>(skills: T[], now: Date): T[] {
  const weakIds = new Set(weakSkills(skills).map((s) => s.skillId));
  return skills
    .filter((s) => s.status !== "NOT_STARTED")
    .filter((s) => weakIds.has(s.skillId) || (s.nextReviewAt !== null && new Date(s.nextReviewAt) <= now))
    .sort(
      (a, b) =>
        Number(weakIds.has(b.skillId)) - Number(weakIds.has(a.skillId)) ||
        b.reviewPriority - a.reviewPriority,
    );
}

export function practiceRecommendations<T extends SkillMasterySummary>(skills: T[]) {
  return weakSkills(skills)
    .slice(0, RECOMMENDATION_RULES.maxRecommendations)
    .map((s) => ({ skill: s, message: `Practice ${s.title}` }));
}
