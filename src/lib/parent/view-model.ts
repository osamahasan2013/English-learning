import type {
  AdaptiveRecommendation,
  RecommendationKind,
  RecommendationPriority,
} from "@/lib/learning/adaptive";
import { DOMAIN_NAMES, DOMAINS, type Domain } from "@/lib/learning/assessment-blueprint";
import type { PlanItem } from "@/lib/learning/daily-plan";
import { MASTERY_STATUSES, masteryRank, type MasteryStatus } from "@/lib/learning/mastery";
import { EVIDENCE_LABELS } from "@/lib/learning/readiness";
import { DEFAULT_RULES, type Confidence } from "@/lib/learning/rules";

// The parent experience's PRESENTATION read-model (Phase 10, ADR-050). Pure and
// deterministic: it takes what the authoritative systems already computed — skill mastery,
// instructional readiness, the adaptive recommendations and daily plan (adaptive.ts),
// assessment history, lesson runs — and turns it into parent wording. It decides nothing
// about learning: no mastery, no level, no recommendation, no review is computed here, and
// nothing it returns is stored. Every label below is documented in docs/architecture.md →
// "Parent experience".

// ---------------------------------------------------------------------------------------
// Inputs (shapes the server loaders already return)

export type ParentSkill = {
  skillId: string;
  title: string;
  domain: Domain | null;
  status: MasteryStatus;
  masteryScore: number;
  attempts: number;
  lastPracticedAt: string | null;
};

export type ParentReadiness = {
  domain: Domain;
  name: string;
  teachingLevelName: string;
  confidence: Confidence;
  confident: boolean;
  source: "assessment" | "mastery" | "inferred" | "default";
  strengths: { skillId: string; title: string; detail: string }[];
  needs: { skillId: string; title: string; detail: string }[];
};

export type ParentSitting = {
  id: string;
  title: string;
  type: string;
  status: "in_progress" | "completed" | "abandoned" | "expired";
  startedAt: string;
  completedAt: string | null;
};

export type ParentRun = {
  id: string;
  title: string;
  emoji: string;
  completedAt: string;
  correct: number;
  total: number;
};

// ---------------------------------------------------------------------------------------
// Wording

// Mastery status in parent words: a short label and what it means. The engine's bands are
// in docs/curriculum.md → "Mastery model"; these sentences only describe them.
export const PARENT_MASTERY_TEXT: Record<MasteryStatus, { label: string; meaning: string }> = {
  MASTERED: { label: "Mastered", meaning: "Consistently demonstrates this skill" },
  ALMOST_MASTERED: {
    label: "Almost there",
    meaning: "Usually right; a little more practice makes it secure",
  },
  PRACTICING: { label: "Practising", meaning: "Getting it right more often" },
  LEARNING: { label: "Learning", meaning: "Still developing this skill" },
  NOT_STARTED: { label: "Not started", meaning: "Not practised yet" },
};

export type DomainState =
  | "NOT_ENOUGH_EVIDENCE"
  | "LIMITED_EVIDENCE"
  | "NEEDS_REVIEW"
  | "LEARNING"
  | "PRACTICING"
  | "ALMOST_MASTERED"
  | "MASTERED";

export const DOMAIN_STATE_TEXT: Record<DomainState, { label: string; help: string }> = {
  NOT_ENOUGH_EVIDENCE: {
    label: "Not enough evidence yet",
    help: "No answers in this area yet.",
  },
  LIMITED_EVIDENCE: {
    label: "Limited evidence",
    help: "Some answers, but no skill has been practised enough to judge yet.",
  },
  NEEDS_REVIEW: {
    label: "Needs review",
    help: "The practice plan brings back a skill in this area that is not secure yet.",
  },
  LEARNING: { label: "Learning", help: "Most practised skills here are still developing." },
  PRACTICING: { label: "Practising", help: "Most practised skills here are getting right more often." },
  ALMOST_MASTERED: { label: "Almost there", help: "Most practised skills here are nearly secure." },
  MASTERED: { label: "Mastered", help: "Most practised skills here are currently mastered." },
};

export const KIND_TEXT: Record<RecommendationKind, string> = {
  repair: "Practise first",
  review: "Review",
  continue: "Continue",
  target: "Next lesson",
  reassess: "Re-check",
  stretch: "Stretch",
};

export const PRIORITY_TEXT: Record<RecommendationPriority, string> = {
  high: "Do first",
  medium: "Next",
  low: "When there is time",
};

// ---------------------------------------------------------------------------------------
// Domain snapshot

export type DomainSnapshot = {
  domain: Domain;
  name: string;
  state: DomainState;
  label: string;
  help: string;
  // Practised skills per mastery status (never a percentage).
  counts: Record<MasteryStatus, number>;
  practised: number;
  answers: number;
  // Skills the adaptive engine brings back (review / repair), in its order.
  toReview: string[];
};

// How a domain is summarised (deterministic; docs/architecture.md → "Parent experience"):
//   no answers                                   → Not enough evidence yet
//   no skill with review.minAttempts answers yet → Limited evidence
//   an adaptive review/repair (high or medium)   → Needs review
//   otherwise the status most JUDGED skills hold (ties → the lower status).
export function domainSnapshot(args: {
  domain: Domain;
  skills: ParentSkill[];
  recommendations: AdaptiveRecommendation[];
  minAttempts?: number;
}): DomainSnapshot {
  const minAttempts = args.minAttempts ?? DEFAULT_RULES.review.minAttempts;
  const mine = args.skills.filter((s) => s.domain === args.domain && s.attempts > 0);
  const counts = Object.fromEntries(MASTERY_STATUSES.map((s) => [s, 0])) as Record<MasteryStatus, number>;
  for (const s of mine) counts[s.status]++;
  const answers = mine.reduce((n, s) => n + s.attempts, 0);
  const toReview = unique(
    args.recommendations
      .filter(
        (r) =>
          r.domain === args.domain && (r.kind === "review" || r.kind === "repair") && r.priority !== "low",
      )
      .map((r) => r.reasons[0]?.skillTitle || r.title),
  );
  const judged = mine.filter((s) => s.attempts >= minAttempts);
  let state: DomainState;
  if (answers === 0) state = "NOT_ENOUGH_EVIDENCE";
  else if (judged.length === 0) state = "LIMITED_EVIDENCE";
  else if (toReview.length > 0) state = "NEEDS_REVIEW";
  else state = predominantStatus(judged.map((s) => s.status));
  return {
    domain: args.domain,
    name: DOMAIN_NAMES[args.domain],
    state,
    ...DOMAIN_STATE_TEXT[state],
    counts,
    practised: mine.length,
    answers,
    toReview,
  };
}

function predominantStatus(statuses: MasteryStatus[]): Exclude<DomainState, "NOT_ENOUGH_EVIDENCE"> {
  const tally = new Map<MasteryStatus, number>();
  for (const s of statuses) tally.set(s, (tally.get(s) ?? 0) + 1);
  const best = [...tally].sort((a, b) => b[1] - a[1] || masteryRank(a[0]) - masteryRank(b[0]))[0][0];
  return best === "NOT_STARTED" ? "LEARNING" : best;
}

// "3 mastered · 1 learning" — the counts behind a state, highest status first.
export function countsText(counts: Record<MasteryStatus, number>): string {
  return [...MASTERY_STATUSES]
    .reverse()
    .filter((s) => s !== "NOT_STARTED" && counts[s] > 0)
    .map((s) => `${counts[s]} ${PARENT_MASTERY_TEXT[s].label.toLowerCase()}`)
    .join(" · ");
}

// ---------------------------------------------------------------------------------------
// Trend (presentation only — never feeds mastery)

export type TrendPoint = { at: string; correct: boolean };
export type Trend =
  | { kind: "insufficient"; answers: number }
  | {
      kind: "up" | "steady" | "down";
      answers: number;
      earlier: { correct: number; total: number };
      recent: { correct: number; total: number };
    };

// The latest TREND_WINDOW first-try lesson answers in an area, split into an earlier and a
// recent half. Shown only when each half has at least TREND_MIN_PER_HALF answers; "up" or
// "down" only when the share right differs by at least TREND_MIN_CHANGE points.
export const TREND_WINDOW = 40;
export const TREND_MIN_PER_HALF = 10;
export const TREND_MIN_CHANGE = 10;

export function answerTrend(points: TrendPoint[]): Trend {
  const latest = [...points].sort((a, b) => a.at.localeCompare(b.at)).slice(-TREND_WINDOW);
  const half = Math.floor(latest.length / 2);
  if (half < TREND_MIN_PER_HALF) return { kind: "insufficient", answers: latest.length };
  const earlierPart = latest.slice(latest.length - 2 * half, latest.length - half);
  const recentPart = latest.slice(latest.length - half);
  const tally = (p: TrendPoint[]) => ({ correct: p.filter((x) => x.correct).length, total: p.length });
  const earlier = tally(earlierPart);
  const recent = tally(recentPart);
  const change = (100 * (recent.correct - earlier.correct)) / half;
  const kind = change >= TREND_MIN_CHANGE ? "up" : change <= -TREND_MIN_CHANGE ? "down" : "steady";
  return { kind, answers: 2 * half, earlier, recent };
}

export function trendText(trend: Trend): string {
  switch (trend.kind) {
    case "insufficient":
      return "Not enough answers yet to show a trend.";
    case "up":
      return `Getting more right lately (${trend.earlier.correct} of ${trend.earlier.total} right first time before, ${trend.recent.correct} of ${trend.recent.total} recently).`;
    case "steady":
      return `About the same lately (${trend.earlier.correct} of ${trend.earlier.total} right first time before, ${trend.recent.correct} of ${trend.recent.total} recently).`;
    case "down":
      return `Fewer right lately (${trend.earlier.correct} of ${trend.earlier.total} right first time before, ${trend.recent.correct} of ${trend.recent.total} recently) — a little extra practice helps.`;
  }
}

// ---------------------------------------------------------------------------------------
// Today, practice and guidance (all from adaptive.ts — this adds no recommendation)

export type ActivityTarget = { lessonId: string | null; recheck: AdaptiveRecommendation["recheck"] };

// Where a recommendation leads in child mode (the same rule as the child home).
export function childHref(r: ActivityTarget): string | null {
  if (r.lessonId) return `/child/learn/${r.lessonId}`;
  if (r.recheck) return `/child/check/${r.recheck.assessmentCode}?skill=${r.recheck.skillId}`;
  return null;
}

// The only child-mode destinations a parent "Start" button may hand over to.
const START_PATH = /^\/child\/(learn\/[0-9a-f-]{36}|check\/[a-z0-9-]{1,64}\?skill=[0-9a-f-]{36})$/i;
export function isStartPath(path: string): boolean {
  return START_PATH.test(path);
}

export type ActionItem = {
  key: string;
  title: string;
  emoji: string;
  minutes: number;
  kind: RecommendationKind;
  kindLabel: string;
  priority: RecommendationPriority;
  priorityLabel: string;
  domainName: string | null;
  reason: string;
  href: string | null;
};

function toAction(r: AdaptiveRecommendation, minutes = r.minutes): ActionItem {
  return {
    key: r.key,
    title: r.title,
    emoji: r.emoji,
    minutes,
    kind: r.kind,
    kindLabel: KIND_TEXT[r.kind],
    priority: r.priority,
    priorityLabel: PRIORITY_TEXT[r.priority],
    domainName: r.domain ? DOMAIN_NAMES[r.domain] : null,
    reason: r.parentMessage,
    href: childHref(r),
  };
}

export type TodayView = { items: ActionItem[]; minutes: number; nothingUrgent: boolean };

// Today's plan (buildDailyPlan) with each item's parent reason from its recommendation.
export function todayView(plan: PlanItem[], recommendations: AdaptiveRecommendation[]): TodayView {
  const byKey = new Map(recommendations.map((r) => [r.key, r]));
  const items = plan.flatMap((p) => {
    const r = byKey.get(p.key);
    return r ? [toAction(r, p.minutes)] : [];
  });
  return {
    items,
    minutes: items.reduce((n, i) => n + i.minutes, 0),
    nothingUrgent: !recommendations.some((r) => r.priority === "high"),
  };
}

export type PracticeView = { top: ActionItem | null; options: ActionItem[]; later: ActionItem[] };

// The adaptive order as is: the first is the top priority, the next (up to 4) the options.
export function practiceView(recommendations: AdaptiveRecommendation[], optionCount = 4): PracticeView {
  const items = recommendations.map((r) => toAction(r));
  return {
    top: items[0] ?? null,
    options: items.slice(1, 1 + optionCount),
    later: items.slice(1 + optionCount),
  };
}

// What a parent can do at home for a recommendation: tied to its domain and skill, never a
// claim about the child. Phonics is about SOUNDS: the tip says so (not letter names).
export function homeGuidance(r: Pick<AdaptiveRecommendation, "domain" | "title" | "reasons">): string {
  const skill = r.reasons[0]?.skillTitle || r.title;
  switch (r.domain) {
    case "PHONICS":
      return `Look for “${skill}” in books and signs together and say its sound — the sound, not the letter name.`;
    case "VOCABULARY":
      return `Use words from “${skill}” in everyday talk; ask your child to point to, act out or draw them.`;
    case "SPELLING":
      return `Say a word from “${skill}” slowly, sound by sound, and let your child write or build it. Praise each sound they get right.`;
    case "READING":
      return `Read a short text together and talk about it: who, what, where. Re-reading a favourite is good practice for “${skill}”.`;
    case "WRITING":
      return `Let your child write a short sentence about their day, then check it together: a capital letter, spaces between words, an end mark.`;
    default:
      return "A few minutes of regular practice works better than one long session.";
  }
}

// ---------------------------------------------------------------------------------------
// Levels, strengths and needs, recent learning, assessment status, attention notes

export type LevelLine = {
  domain: Domain;
  name: string;
  learningAt: string;
  evidence: string;
  fromEvidence: boolean;
};

// "Learning at" per domain — never one collapsed level, never a school grade.
export function levelLines(readiness: ParentReadiness[]): LevelLine[] {
  return readiness.map((r) => ({
    domain: r.domain,
    name: r.name,
    learningAt: r.teachingLevelName,
    evidence: EVIDENCE_LABELS[r.confidence],
    fromEvidence: r.confident && r.source !== "default",
  }));
}

export type NoteItem = { title: string; domainName: string | null; why: string };

// Strengths from the evidence (readiness) and current mastery; needs in the adaptive
// engine's order (review / repair it chose), then needs the last check found.
export function strengthsAndNeeds(args: {
  readiness: ParentReadiness[];
  recommendations: AdaptiveRecommendation[];
  skills: ParentSkill[];
  limit?: number;
}): { strengths: NoteItem[]; needs: NoteItem[] } {
  const limit = args.limit ?? 5;
  const needs: NoteItem[] = [];
  const seen = new Set<string>();
  const push = (list: NoteItem[], item: NoteItem) => {
    const key = item.title.toLocaleLowerCase();
    if (seen.has(key) || list.length >= limit) return;
    seen.add(key);
    list.push(item);
  };
  for (const r of args.recommendations)
    if ((r.kind === "repair" || r.kind === "review") && r.priority !== "low")
      push(needs, {
        title: r.reasons[0]?.skillTitle || r.title,
        domainName: r.domain ? DOMAIN_NAMES[r.domain] : null,
        why: r.parentMessage,
      });
  for (const d of args.readiness)
    for (const n of d.needs) push(needs, { title: n.title, domainName: d.name, why: n.detail });

  const strengths: NoteItem[] = [];
  const mastered = args.skills
    .filter((s) => s.status === "MASTERED")
    .sort((a, b) => (b.lastPracticedAt ?? "").localeCompare(a.lastPracticedAt ?? ""));
  for (const s of mastered)
    push(strengths, {
      title: s.title,
      domainName: s.domain ? DOMAIN_NAMES[s.domain] : null,
      why: PARENT_MASTERY_TEXT.MASTERED.meaning,
    });
  for (const d of args.readiness)
    for (const s of d.strengths) push(strengths, { title: s.title, domainName: d.name, why: s.detail });
  return { strengths, needs };
}

export type RecentItem = {
  key: string;
  kind: "lesson" | "check";
  title: string;
  emoji: string;
  at: string;
  detail: string;
};

// Meaningful completed learning only: finished lessons and finished checks.
export function recentLearning(runs: ParentRun[], sittings: ParentSitting[], limit = 6): RecentItem[] {
  const lessons: RecentItem[] = runs.map((r) => ({
    key: `run:${r.id}`,
    kind: "lesson",
    title: r.title,
    emoji: r.emoji,
    at: r.completedAt,
    detail: `Lesson finished · ${r.correct} of ${r.total} right first time`,
  }));
  const checks: RecentItem[] = sittings
    .filter((s) => s.status === "completed" && s.completedAt)
    .map((s) => ({
      key: `check:${s.id}`,
      kind: "check",
      title: s.title,
      emoji: "🎯",
      at: s.completedAt!,
      detail: "Check finished",
    }));
  return [...lessons, ...checks]
    .sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export type AssessmentStatus = {
  latest: { title: string; at: string } | null;
  waiting: number;
  placementDone: boolean;
  message: string;
};

export function assessmentStatus(args: { history: ParentSitting[]; waiting: number }): AssessmentStatus {
  const completed = args.history
    .filter((s) => s.status === "completed" && s.completedAt)
    .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));
  const latest = completed[0] ? { title: completed[0].title, at: completed[0].completedAt! } : null;
  const placementDone = completed.some((s) => s.type === "placement");
  const message = latest
    ? "Levels use the checks and lesson practice together. A check is a snapshot, not a school grade."
    : "No check yet. Each area starts at the learning level you set; lesson practice adds evidence.";
  return { latest, waiting: args.waiting, placementDone, message };
}

export type AttentionNote = { key: string; text: string; href?: string };

// Lightweight in-app notes only (no push, email or SMS). Neutral wording, no alarms.
export function attentionNotes(args: {
  childName: string;
  childId: string;
  waitingChecks: number;
  recommendations: AdaptiveRecommendation[];
  lessonsCompleted: number;
  activeDaysThisWeek: number;
  placementDone: boolean;
  hasEvidence: boolean;
}): AttentionNote[] {
  const notes: AttentionNote[] = [];
  const q = `?child=${args.childId}`;
  if (args.waitingChecks > 0)
    notes.push({
      key: "check-waiting",
      text: `A check is waiting for ${args.childName} on their home screen.`,
      href: `/parent/assessments${q}`,
    });
  const first = args.recommendations.filter((r) => r.priority === "high").length;
  if (first > 0)
    notes.push({
      key: "do-first",
      text: `${first} ${first === 1 ? "thing" : "things"} to practise first.`,
      href: `/parent/practice${q}`,
    });
  if (args.lessonsCompleted > 0 && args.activeDaysThisWeek === 0)
    notes.push({ key: "quiet-week", text: "No lessons in the last 7 days." });
  if (!args.placementDone && !args.hasEvidence)
    notes.push({
      key: "find-level",
      text: `“Find My Level” has not been taken yet. It helps place ${args.childName} in each area.`,
      href: `/parent/assessments${q}`,
    });
  return notes;
}

// ---------------------------------------------------------------------------------------
// The dashboard view model

export type ParentDashboardViewModel = {
  levels: LevelLine[];
  hasEvidence: boolean;
  today: TodayView;
  next: ActionItem | null;
  recent: RecentItem[];
  domains: DomainSnapshot[];
  strengths: NoteItem[];
  needs: NoteItem[];
  assessment: AssessmentStatus;
  attention: AttentionNote[];
};

export function buildParentDashboard(args: {
  childId: string;
  childName: string;
  readiness: ParentReadiness[];
  recommendations: AdaptiveRecommendation[];
  plan: PlanItem[];
  skills: ParentSkill[];
  runs: ParentRun[];
  history: ParentSitting[];
  waitingChecks: number;
  lessonsCompleted: number;
  activeDaysThisWeek: number;
  minAttempts?: number;
}): ParentDashboardViewModel {
  const assessment = assessmentStatus({ history: args.history, waiting: args.waitingChecks });
  const hasEvidence = args.readiness.some((r) => r.source !== "default");
  const { strengths, needs } = strengthsAndNeeds(args);
  return {
    levels: levelLines(args.readiness),
    hasEvidence,
    today: todayView(args.plan, args.recommendations),
    next: practiceView(args.recommendations).top,
    recent: recentLearning(args.runs, args.history),
    domains: DOMAINS.map((domain) =>
      domainSnapshot({
        domain,
        skills: args.skills,
        recommendations: args.recommendations,
        minAttempts: args.minAttempts,
      }),
    ),
    strengths,
    needs,
    assessment,
    attention: attentionNotes({
      childName: args.childName,
      childId: args.childId,
      waitingChecks: args.waitingChecks,
      recommendations: args.recommendations,
      lessonsCompleted: args.lessonsCompleted,
      activeDaysThisWeek: args.activeDaysThisWeek,
      placementDone: assessment.placementDone,
      hasEvidence,
    }),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
