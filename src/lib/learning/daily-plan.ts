import type { AdaptiveRecommendation, RecommendationKind } from "@/lib/learning/adaptive";
import { DEFAULT_RULES, type AdaptiveRules } from "@/lib/learning/rules";

// "Today's learning": the parent's daily minutes shared out over the adaptive
// recommendations (adaptive.ts) by the learning zone (rules.adaptive.zone) — review,
// prerequisite repair, current target lessons and an occasional stretch — so a day is never
// only easy review, only failed content or only new lessons. Pure and deterministic; it
// adds no recommendation of its own.

export const DAILY_MINUTE_OPTIONS = [10, 15, 20, 30, 45] as const;
export type DailyMinutes = (typeof DAILY_MINUTE_OPTIONS)[number];

// The shortest useful slot: below this a lesson is not started.
export const MIN_SLOT_MINUTES = 3;

export type ZoneBucket = "review" | "repair" | "target" | "stretch";
const BUCKET: Record<RecommendationKind, ZoneBucket> = {
  review: "review",
  reassess: "review",
  repair: "repair",
  continue: "target",
  target: "target",
  stretch: "stretch",
};

export type PlanItem = {
  key: string;
  kind: RecommendationKind;
  bucket: ZoneBucket;
  lessonId: string | null;
  recheck: AdaptiveRecommendation["recheck"];
  title: string;
  emoji: string;
  minutes: number;
  // The child-facing reason ("Let's practise sh first.").
  message: string;
};

export function buildDailyPlan(args: {
  dailyMinutes: number;
  recommendations: AdaptiveRecommendation[];
  rules?: AdaptiveRules;
}): PlanItem[] {
  const zone = (args.rules ?? DEFAULT_RULES.adaptive).zone;
  const budget: Record<ZoneBucket, number> = {
    review: Math.round(args.dailyMinutes * zone.review),
    repair: Math.round(args.dailyMinutes * zone.repair),
    target: Math.round(args.dailyMinutes * zone.target),
    stretch: Math.round(args.dailyMinutes * zone.stretch),
  };
  let remaining = args.dailyMinutes;
  const chosen = new Map<string, PlanItem>();
  const take = (r: AdaptiveRecommendation, allowance: number) => {
    const minutes = Math.min(r.minutes, allowance, remaining);
    if (minutes < MIN_SLOT_MINUTES || chosen.has(r.key)) return 0;
    chosen.set(r.key, {
      key: r.key,
      kind: r.kind,
      bucket: BUCKET[r.kind],
      lessonId: r.lessonId,
      recheck: r.recheck,
      title: r.title,
      emoji: r.emoji,
      minutes,
      message: r.childMessage,
    });
    remaining -= minutes;
    return minutes;
  };

  // First pass: each bucket within its share, in recommendation (priority) order.
  for (const r of args.recommendations) {
    const bucket = BUCKET[r.kind];
    budget[bucket] -= take(r, budget[bucket]);
  }
  // Unused minutes go to whatever is left, target lessons first, then review, repair, stretch.
  const fallback: ZoneBucket[] = ["target", "review", "repair", "stretch"];
  for (const bucket of fallback)
    for (const r of args.recommendations)
      if (BUCKET[r.kind] === bucket && remaining >= MIN_SLOT_MINUTES) take(r, remaining);

  // Order of the day: repair first (it unblocks the rest), one new lesson while attention is
  // fresh, then review, further lessons, and the stretch last.
  const items = [...chosen.values()];
  const of = (b: ZoneBucket) => items.filter((i) => i.bucket === b);
  const targets = of("target");
  return [...of("repair"), ...targets.slice(0, 1), ...of("review"), ...targets.slice(1), ...of("stretch")];
}
