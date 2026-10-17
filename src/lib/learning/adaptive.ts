import { DOMAIN_NAMES, type Domain } from "@/lib/learning/assessment-blueprint";
import { masteryRank, type MasteryStatus } from "@/lib/learning/mastery";
import { confidenceRank, EVIDENCE_LABELS } from "@/lib/learning/readiness";
import type { ReviewReason } from "@/lib/learning/review-queue";
import {
  DEFAULT_RULES,
  type AdaptiveRules,
  type AssessmentRules,
  type Confidence,
  type ReviewRules,
} from "@/lib/learning/rules";

// THE adaptive recommendation engine (Phase 9, ADR-048). Pure and deterministic: the same
// child state, content and time give the same recommendations, in the same order, every
// time. The child home, the daily plan and the parent dashboard all take their
// recommendations from here (src/lib/server/adaptive.ts loads the input); no page has a
// recommendation rule of its own. Every recommendation carries its reasons, so "why this
// lesson?" always has an answer — a short one for the child, a detailed one for the parent.
//
// Candidates (each domain on its own instructional level — never one averaged level):
//   repair    a prerequisite of a current skill that is weak or an assessment gap
//   review    due review items, struggling skills, assessment gaps
//   continue  a lesson started and not finished
//   target    the next lessons on each domain's path at its instructional level
//   reassess  a gap the child has practised enough to re-check
//   stretch   a first lesson of the next level where the current level is mostly secure
// Priority (docs/curriculum.md → "Adaptive recommendations"):
//   HIGH   prerequisite gap blocking a current skill; assessment gap; repeated recent errors;
//          a weak important skill; an important skill overdue for review
//   MEDIUM continue; the next lesson at the instructional level; ordinary due review; re-check
//   LOW    stretch; review of a mastered skill (maintenance)
// Filters: unpublished content never appears (only published lessons are loaded); mastered
// skills are not taught again as new lessons; a lesson finished within fatigueHours is held
// back unless the reason is urgent; one entry per lesson (reasons merged).

export type AdaptiveLesson = {
  lessonId: string;
  title: string;
  emoji: string;
  estimatedMinutes: number;
  skillId: string;
  domain: Domain | null;
  levelRank: number;
  // Position on the curriculum path (unit → skill → lesson order) within the level.
  pathOrder: number;
  subjectName: string;
};

export type AdaptiveLessonState = {
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  lastCompletedAt: string | null;
};

export type AdaptiveSkill = {
  skillId: string;
  title: string;
  domain: Domain | null;
  levelRank: number;
  importance: number;
  status: MasteryStatus;
  masteryScore: number;
  attempts: number;
  // Wrong answers among the latest five first tries.
  recentErrors: number;
};

export type AdaptiveReview = {
  itemKey: string;
  skillId: string | null;
  lessonId: string | null;
  reason: ReviewReason;
  priority: number;
  dueAt: string;
};

export type AdaptiveDomain = {
  domain: Domain;
  rank: number;
  confidence: Confidence;
  // Share of the current level's skills secured by practice (readiness.practiceCoverage).
  coverage: number;
  nextRank: number | null;
  levelName: string;
  nextLevelName: string | null;
};

export type AdaptiveGap = {
  skillId: string;
  percent: number;
  // First tries on the skill since the sitting, and how many were right.
  attemptsSince: number;
  correctSince: number;
};

export type AdaptiveInput = {
  domains: AdaptiveDomain[];
  lessons: AdaptiveLesson[];
  lessonStates: ReadonlyMap<string, AdaptiveLessonState>;
  skills: ReadonlyMap<string, AdaptiveSkill>;
  prerequisites: ReadonlyMap<string, string[]>;
  // The first published lesson practising each skill (any level).
  practiceLesson: ReadonlyMap<string, AdaptiveLesson>;
  reviews: AdaptiveReview[];
  gaps: AdaptiveGap[];
  now: Date;
  rules?: AdaptiveRules;
  assessmentRules?: AssessmentRules;
  reviewRules?: ReviewRules;
};

export type RecommendationKind = "repair" | "review" | "continue" | "target" | "reassess" | "stretch";
export type RecommendationPriority = "high" | "medium" | "low";
export type ReasonCode =
  | "prerequisite_gap"
  | "assessment_gap"
  | "repeated_errors"
  | "weak_skill"
  | "due_review"
  | "maintenance"
  | "continue"
  | "target"
  | "stretch"
  | "reassess";

export type RecommendationReason = {
  code: ReasonCode;
  skillTitle?: string;
  forSkillTitle?: string;
  domain?: Domain;
  levelName?: string;
  confidence?: Confidence;
  detail?: string;
};

export type AdaptiveRecommendation = {
  key: string;
  kind: RecommendationKind;
  priority: RecommendationPriority;
  lessonId: string | null;
  title: string;
  emoji: string;
  domain: Domain | null;
  skillId: string | null;
  minutes: number;
  // A re-check instead of a lesson: the assessment and the skill to re-check.
  recheck: { assessmentCode: string; skillId: string } | null;
  reasons: RecommendationReason[];
  childMessage: string;
  parentMessage: string;
};

export const RECHECK_ASSESSMENT = "skill-recheck";

const PRIORITY_ORDER: RecommendationPriority[] = ["high", "medium", "low"];
const KIND_ORDER: RecommendationKind[] = ["repair", "review", "continue", "target", "reassess", "stretch"];
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type Draft = Omit<AdaptiveRecommendation, "childMessage" | "parentMessage"> & { sortKey: number };

export function recommend(input: AdaptiveInput): AdaptiveRecommendation[] {
  const rules = input.rules ?? DEFAULT_RULES.adaptive;
  const assessmentRules = input.assessmentRules ?? DEFAULT_RULES.assessment;
  const reviewRules = input.reviewRules ?? DEFAULT_RULES.review;
  const drafts = new Map<string, Draft>();
  const gapIds = new Set(input.gaps.map((g) => g.skillId));
  const skillTitle = (id: string | null) => (id ? (input.skills.get(id)?.title ?? "") : "");
  const isWeak = (s: AdaptiveSkill | undefined) =>
    !!s && s.attempts >= reviewRules.minAttempts && s.masteryScore < reviewRules.weakBelowScore;

  const add = (
    lesson: AdaptiveLesson | undefined,
    kind: RecommendationKind,
    priority: RecommendationPriority,
    reason: RecommendationReason,
    sortKey: number,
    recheck: Draft["recheck"] = null,
  ) => {
    const key = recheck ? `recheck:${recheck.skillId}` : lesson ? `lesson:${lesson.lessonId}` : null;
    if (!key) return;
    const existing = drafts.get(key);
    if (existing) {
      const same = (r: RecommendationReason) => r.code === reason.code && r.skillTitle === reason.skillTitle;
      // The deciding reason leads (the child's message is built from the first one).
      const outranks =
        PRIORITY_ORDER.indexOf(priority) < PRIORITY_ORDER.indexOf(existing.priority) ||
        (priority === existing.priority && KIND_ORDER.indexOf(kind) < KIND_ORDER.indexOf(existing.kind));
      if (outranks) {
        existing.priority = priority;
        existing.kind = kind;
        existing.reasons = [reason, ...existing.reasons.filter((r) => !same(r))];
      } else if (!existing.reasons.some(same)) existing.reasons.push(reason);
      existing.sortKey = Math.min(existing.sortKey, sortKey);
      return;
    }
    const skillId = recheck?.skillId ?? lesson?.skillId ?? null;
    drafts.set(key, {
      key,
      kind,
      priority,
      lessonId: lesson?.lessonId ?? null,
      title: lesson?.title ?? skillTitle(skillId),
      emoji: lesson?.emoji ?? "🎯",
      domain: lesson?.domain ?? input.skills.get(skillId ?? "")?.domain ?? null,
      skillId,
      minutes: lesson?.estimatedMinutes ?? 5,
      recheck,
      reasons: [reason],
      sortKey,
    });
  };

  // A prerequisite GAP (repaired first): an assessment gap, or practised enough to judge
  // (review minAttempts) and weak / still below PRACTICING. A prerequisite not practised
  // enough yet is not a gap: from a lower level it is assumed known; at the same level or
  // above it is still being learned, so the lesson that needs it waits (the path teaches the
  // prerequisite first).
  const judged = (s: AdaptiveSkill) => s.attempts >= reviewRules.minAttempts;
  const blockingPrerequisites = (skillId: string) =>
    (input.prerequisites.get(skillId) ?? []).filter((p) => {
      const pre = input.skills.get(p);
      if (gapIds.has(p)) return true;
      if (!pre || !judged(pre)) return false;
      return isWeak(pre) || masteryRank(pre.status) < masteryRank("PRACTICING");
    });
  const unlearnedPrerequisites = (skillId: string, levelRank: number) =>
    (input.prerequisites.get(skillId) ?? []).filter((p) => {
      const pre = input.skills.get(p);
      return !!pre && !judged(pre) && !gapIds.has(p) && pre.levelRank >= levelRank;
    });

  const repair = (prereqId: string, forSkillId: string, sortKey: number) => {
    const lesson = input.practiceLesson.get(prereqId);
    if (!lesson) return false;
    add(
      lesson,
      "repair",
      "high",
      { code: "prerequisite_gap", skillTitle: skillTitle(prereqId), forSkillTitle: skillTitle(forSkillId) },
      sortKey,
    );
    return true;
  };

  // 1. Each domain's path at its instructional level.
  input.domains.forEach((d, domainIndex) => {
    const path = input.lessons
      .filter((l) => l.domain === d.domain && l.levelRank === d.rank)
      .sort((a, b) => a.pathOrder - b.pathOrder);
    const open = path
      .filter((l) => input.lessonStates.get(l.lessonId)?.status !== "COMPLETED")
      .filter((l) => input.skills.get(l.skillId)?.status !== "MASTERED");
    // Lessons whose prerequisites are learned (or only need repair); if none, the first open
    // lesson (played as a preview, as the lesson page does).
    const ready = open.filter((l) => unlearnedPrerequisites(l.skillId, d.rank).length === 0);
    const targets = (ready.length > 0 ? ready : open).slice(0, rules.targetLessonsPerDomain);
    targets.forEach((lesson, i) => {
      for (const pre of blockingPrerequisites(lesson.skillId))
        repair(pre, lesson.skillId, domainIndex * 10 + i);
      add(
        lesson,
        "target",
        "medium",
        { code: "target", domain: d.domain, levelName: d.levelName, confidence: d.confidence },
        1000 + i * 100 + domainIndex,
      );
    });

    // 6. Stretch: the next level is in reach.
    if (
      d.nextRank !== null &&
      confidenceRank(d.confidence) >= confidenceRank(rules.stretchMinConfidence) &&
      d.coverage >= rules.stretchAfterCoverage
    ) {
      const first = input.lessons
        .filter((l) => l.domain === d.domain && l.levelRank === d.nextRank)
        .sort((a, b) => a.pathOrder - b.pathOrder)
        .find((l) => input.lessonStates.get(l.lessonId)?.status !== "COMPLETED");
      if (first)
        add(
          first,
          "stretch",
          "low",
          {
            code: "stretch",
            domain: d.domain,
            levelName: d.nextLevelName ?? "",
            detail: `${Math.round(d.coverage * 100)}% of ${d.levelName} skills secure`,
          },
          domainIndex,
        );
    }
  });

  // 2. Struggling skills: repair a weak prerequisite first, else practise the skill itself.
  const struggling = [...input.skills.values()]
    .filter((s) => s.attempts >= reviewRules.minAttempts && (isWeak(s) || s.recentErrors >= 2))
    .sort((a, b) => a.masteryScore - b.masteryScore || (a.skillId < b.skillId ? -1 : 1));
  struggling.forEach((s, i) => {
    const repaired = blockingPrerequisites(s.skillId).some((p) => repair(p, s.skillId, i));
    if (repaired) return;
    const lesson = input.practiceLesson.get(s.skillId);
    const repeated = s.recentErrors >= 2;
    add(
      lesson,
      "review",
      repeated || s.importance >= rules.importantSkill ? "high" : "medium",
      {
        code: repeated ? "repeated_errors" : "weak_skill",
        skillTitle: s.title,
        detail: repeated
          ? `${s.recentErrors} of the last 5 answers were not right`
          : `mastery ${Math.round(s.masteryScore)}%`,
      },
      100 + i,
    );
  });

  // 3. Lessons started and not finished.
  input.lessons
    .filter((l) => input.lessonStates.get(l.lessonId)?.status === "IN_PROGRESS")
    .sort((a, b) => a.levelRank - b.levelRank || a.pathOrder - b.pathOrder)
    .forEach((l, i) => add(l, "continue", "medium", { code: "continue" }, 500 + i));

  // 4. Due review items.
  const due = input.reviews
    .filter((r) => Date.parse(r.dueAt) <= input.now.getTime())
    .sort((a, b) => b.priority - a.priority || a.itemKey.localeCompare(b.itemKey));
  due.forEach((r, i) => {
    const skill = r.skillId ? input.skills.get(r.skillId) : undefined;
    const lesson =
      (r.lessonId ? input.lessons.find((l) => l.lessonId === r.lessonId) : undefined) ??
      (r.skillId ? input.practiceLesson.get(r.skillId) : undefined);
    const overdueDays = (input.now.getTime() - Date.parse(r.dueAt)) / DAY_MS;
    const important = (skill?.importance ?? 3) >= rules.importantSkill;
    let priority: RecommendationPriority = "medium";
    let code: ReasonCode = "due_review";
    if (r.reason === "assessment_gap") [priority, code] = ["high", "assessment_gap"];
    else if (r.reason === "recent_errors") [priority, code] = ["high", "repeated_errors"];
    else if (r.reason === "weak_skill") [priority, code] = [important ? "high" : "medium", "weak_skill"];
    else if (skill?.status === "MASTERED") [priority, code] = ["low", "maintenance"];
    else if (important && overdueDays >= rules.overdueDays) priority = "high";
    add(lesson, "review", priority, { code, skillTitle: skillTitle(r.skillId) || undefined }, 200 + i);
  });

  // 5. Gaps practised enough to re-check.
  input.gaps
    .filter(
      (g) =>
        g.attemptsSince >= assessmentRules.reassessment.minPracticeAfter &&
        (100 * g.correctSince) / g.attemptsSince >= assessmentRules.reassessment.recentAccuracy,
    )
    .forEach((g, i) =>
      add(
        undefined,
        "reassess",
        "medium",
        {
          code: "reassess",
          skillTitle: skillTitle(g.skillId),
          detail: `${Math.round(g.percent)}% on the check, ${g.correctSince} of ${g.attemptsSince} right since`,
        },
        800 + i,
        { assessmentCode: RECHECK_ASSESSMENT, skillId: g.skillId },
      ),
    );

  // Repetition fatigue: a lesson finished very recently waits, unless the reason is urgent.
  const fresh = (d: Draft) => {
    if (!d.lessonId || d.priority === "high") return true;
    const last = input.lessonStates.get(d.lessonId)?.lastCompletedAt;
    return !last || input.now.getTime() - Date.parse(last) >= rules.fatigueHours * HOUR_MS;
  };

  const sorted = [...drafts.values()]
    .filter(fresh)
    .sort(
      (a, b) =>
        PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.sortKey - b.sortKey ||
        a.key.localeCompare(b.key),
    );
  return interleaveDomains(sorted)
    .slice(0, rules.maxRecommendations)
    .map(({ sortKey: _sortKey, ...d }) => ({
      ...d,
      childMessage: childMessage(d),
      parentMessage: parentMessage(d),
    }));
}

// Within each priority, take domains in turn so one domain does not crowd out the others
// (strong phonics must not hide the reading practice a child needs).
function interleaveDomains(drafts: Draft[]): Draft[] {
  const out: Draft[] = [];
  for (const priority of PRIORITY_ORDER) {
    const group = drafts.filter((d) => d.priority === priority);
    const queues = new Map<string, Draft[]>();
    for (const d of group) {
      const key = d.domain ?? "-";
      queues.set(key, [...(queues.get(key) ?? []), d]);
    }
    const order = [...queues.keys()];
    while (out.length < drafts.length && order.some((k) => queues.get(k)!.length > 0))
      for (const k of order) {
        const next = queues.get(k)!.shift();
        if (next) out.push(next);
      }
  }
  return out;
}

// What the child sees: short, encouraging, no scores.
export function childMessage(d: Pick<AdaptiveRecommendation, "kind" | "reasons">): string {
  const r = d.reasons[0];
  switch (r.code) {
    case "prerequisite_gap":
      return `Let's practise ${r.skillTitle} first.`;
    case "assessment_gap":
      return `Let's practise ${r.skillTitle}.`;
    case "repeated_errors":
    case "weak_skill":
      return `Let's practise ${r.skillTitle} again.`;
    case "due_review":
      return r.skillTitle ? `Time to review ${r.skillTitle}.` : "Time to review.";
    case "maintenance":
      return r.skillTitle ? `Remember ${r.skillTitle}?` : "Remember this one?";
    case "continue":
      return "Keep going — you started this one!";
    case "target":
      return "You're ready for something new!";
    case "stretch":
      return "Try something a little harder!";
    case "reassess":
      return "Show what you learned!";
  }
}

// What the parent sees: the rule behind it, with the evidence.
export function parentMessage(d: Pick<AdaptiveRecommendation, "kind" | "reasons">): string {
  return d.reasons
    .map((r) => {
      switch (r.code) {
        case "prerequisite_gap":
          return `${r.skillTitle} comes before ${r.forSkillTitle} and is not secure yet.`;
        case "assessment_gap":
          return `The last check showed ${r.skillTitle} needs practice.`;
        case "repeated_errors":
          return `${r.skillTitle}: ${r.detail}.`;
        case "weak_skill":
          return `${r.skillTitle} is not secure yet (${r.detail}).`;
        case "due_review":
          return r.skillTitle ? `${r.skillTitle} is due for review.` : "Due for review.";
        case "maintenance":
          return `${r.skillTitle} is mastered; a periodic review keeps it fresh.`;
        case "continue":
          return "Started but not finished yet.";
        case "target":
          return `Next lesson for ${r.domain ? DOMAIN_NAMES[r.domain] : "this area"} at ${r.levelName} (instructional level; ${EVIDENCE_LABELS[r.confidence ?? "INSUFFICIENT"].toLowerCase()}).`;
        case "stretch":
          return `${r.detail} — a first look at ${r.levelName}.`;
        case "reassess":
          return `${r.skillTitle} was weak on the last check and has improved (${r.detail}); a short re-check confirms it.`;
      }
    })
    .join(" ");
}
