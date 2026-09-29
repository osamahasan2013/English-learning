// Builds "Today's learning" from the parent's daily time setting, the child's next new
// lessons and the skills due for review. Weak skills get review time first.

export const DAILY_MINUTE_OPTIONS = [10, 15, 20, 30, 45] as const;
export type DailyMinutes = (typeof DAILY_MINUTE_OPTIONS)[number];

export const PLAN_RULES = {
  // Share of the day reserved for review when something is due; at least one slot.
  reviewShare: 0.3,
  minReviewMinutes: 5,
  maxReviewItems: 2,
} as const;

export type PlanLesson = {
  lessonId: string;
  title: string;
  subjectName: string;
  estimatedMinutes: number;
};

export type PlanReview = {
  skillId: string;
  title: string;
  lessonId: string;
  subjectName: string;
};

export type PlanItem =
  | { kind: "lesson"; lessonId: string; title: string; subjectName: string; minutes: number }
  | {
      kind: "review";
      lessonId: string;
      skillId: string;
      title: string;
      subjectName: string;
      minutes: number;
    };

export function buildDailyPlan(args: {
  dailyMinutes: number;
  nextLessons: PlanLesson[];
  reviews: PlanReview[];
}): PlanItem[] {
  const items: PlanItem[] = [];
  let remaining = args.dailyMinutes;

  const reviews = args.reviews.slice(0, PLAN_RULES.maxReviewItems);
  if (reviews.length > 0) {
    const reviewBudget = Math.max(
      PLAN_RULES.minReviewMinutes,
      Math.round(args.dailyMinutes * PLAN_RULES.reviewShare),
    );
    const perReview = Math.max(PLAN_RULES.minReviewMinutes, Math.floor(reviewBudget / reviews.length));
    for (const review of reviews) {
      if (remaining < PLAN_RULES.minReviewMinutes) break;
      const minutes = Math.min(perReview, remaining);
      items.push({ kind: "review", ...review, minutes });
      remaining -= minutes;
    }
  }

  for (const lesson of args.nextLessons) {
    if (remaining <= 0) break;
    const minutes = Math.min(lesson.estimatedMinutes, remaining);
    items.push({ kind: "lesson", ...lesson, minutes });
    remaining -= minutes;
  }

  // Order: one new lesson first (fresh attention for new material), then reviews, then
  // any further lessons.
  const lessons = items.filter((i) => i.kind === "lesson");
  const reviewItems = items.filter((i) => i.kind === "review");
  return [...lessons.slice(0, 1), ...reviewItems, ...lessons.slice(1)];
}
