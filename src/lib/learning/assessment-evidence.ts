import type { Domain } from "@/lib/learning/assessment-blueprint";
import { DEFAULT_RULES, type AssessmentRules } from "@/lib/learning/rules";

// From raw answers to assessment evidence (Phase 9, ADR-047). Pure; the progress writer
// feeds it the sitting's stored first tries (never anything the device computed).
//
//   RAW PERFORMANCE  activity_attempts: what was answered, right or not, partial credit.
//   EVIDENCE         per section and per skill: what was observed — "4 of 5 short-vowel
//                    words", weighted for items the child had practised before (contamination).
//   (then readiness.ts turns evidence + mastery into instructional readiness, and mastery
//    stays the ordinary skill_mastery recomputed from first tries.)

export type ItemOutcome = "correct" | "incorrect" | "skipped" | "unanswered";

export type SittingItem = {
  questionId: string;
  sectionCode: string;
  domain: Domain;
  levelId: string | null;
  levelRank: number;
  skillId: string;
  outcome: ItemOutcome;
  // 0–1: 1 for a right answer, the share of parts right for a partly right one, 0 otherwise.
  credit: number;
  // The child's answers to this exact question BEFORE the sitting started (practice).
  priorExposures: number;
};

// An item the child had practised before weighs less (it may test memory of that item).
export function contaminationWeight(
  priorExposures: number,
  rules: AssessmentRules = DEFAULT_RULES.assessment,
) {
  const c = rules.contamination;
  if (priorExposures >= c.heavyAfter) return c.heavyWeight;
  if (priorExposures >= c.lightAfter) return c.lightWeight;
  return 1;
}

// Unanswered items (never reached, or left when the child stopped) are not observations and
// are left out; an explicit "I don't know" (skipped) is evidence and counts as 0.
const observed = (i: SittingItem) => i.outcome !== "unanswered";

export type SectionResult = {
  sectionCode: string;
  domain: Domain;
  levelId: string | null;
  levelRank: number;
  served: boolean;
  items: number;
  correct: number;
  skipped: number;
  // Weighted share of credit, 0–100.
  percent: number;
  weight: number;
  passed: boolean;
  skills: string[];
};

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

export function scoreSections(
  items: SittingItem[],
  passPercent: number,
  rules: AssessmentRules = DEFAULT_RULES.assessment,
): SectionResult[] {
  const codes: string[] = [];
  for (const i of items) if (!codes.includes(i.sectionCode)) codes.push(i.sectionCode);
  return codes.map((code) => {
    const all = items.filter((i) => i.sectionCode === code);
    const seen = all.filter(observed);
    const weight = seen.reduce((t, i) => t + contaminationWeight(i.priorExposures, rules), 0);
    const credit = seen.reduce((t, i) => t + i.credit * contaminationWeight(i.priorExposures, rules), 0);
    const percent = weight > 0 ? round((100 * credit) / weight) : 0;
    return {
      sectionCode: code,
      domain: all[0].domain,
      levelId: all[0].levelId,
      levelRank: all[0].levelRank,
      served: seen.length > 0,
      items: seen.length,
      correct: seen.filter((i) => i.outcome === "correct").length,
      skipped: seen.filter((i) => i.outcome === "skipped").length,
      percent,
      weight: round(weight, 3),
      passed: seen.length > 0 && percent >= passPercent,
      skills: [...new Set(seen.map((i) => i.skillId))],
    };
  });
}

export type EvidenceStrength = "secure" | "developing" | "weak" | "insufficient";

export type SkillEvidence = {
  skillId: string;
  domain: Domain;
  levelId: string | null;
  levelRank: number;
  total: number;
  correct: number;
  skipped: number;
  credit: number;
  weight: number;
  percent: number;
  strength: EvidenceStrength;
};

export function strengthOf(
  percent: number,
  weight: number,
  rules: AssessmentRules = DEFAULT_RULES.assessment,
) {
  const e = rules.evidence;
  if (weight < e.minItems) return "insufficient" as const;
  if (percent >= e.securePercent) return "secure" as const;
  if (percent >= e.developingPercent) return "developing" as const;
  return "weak" as const;
}

export function skillEvidence(
  items: SittingItem[],
  rules: AssessmentRules = DEFAULT_RULES.assessment,
): SkillEvidence[] {
  const bySkill = new Map<string, SittingItem[]>();
  for (const i of items.filter(observed)) bySkill.set(i.skillId, [...(bySkill.get(i.skillId) ?? []), i]);
  return [...bySkill].map(([skillId, list]) => {
    const weight = list.reduce((t, i) => t + contaminationWeight(i.priorExposures, rules), 0);
    const credit = list.reduce((t, i) => t + i.credit * contaminationWeight(i.priorExposures, rules), 0);
    const percent = weight > 0 ? round((100 * credit) / weight) : 0;
    // A skill measured at several levels is reported at the highest one.
    const top = list.reduce((a, b) => (b.levelRank > a.levelRank ? b : a));
    return {
      skillId,
      domain: top.domain,
      levelId: top.levelId,
      levelRank: top.levelRank,
      total: list.length,
      correct: list.filter((i) => i.outcome === "correct").length,
      skipped: list.filter((i) => i.outcome === "skipped").length,
      credit: round(credit, 3),
      weight: round(weight, 3),
      percent,
      strength: strengthOf(percent, weight, rules),
    };
  });
}

// A weakness worth a review item (assessment_gap): enough items and few right. One wrong
// answer never makes a gap.
export function isAssessmentGap(
  e: Pick<SkillEvidence, "weight" | "percent">,
  rules = DEFAULT_RULES.assessment,
) {
  return e.weight >= rules.gap.minItems && e.percent < rules.gap.belowPercent;
}

// Reassessment: how the newer sitting compares with the one it re-checks, per skill.
export type SkillComparison = {
  skillId: string;
  before: number | null;
  after: number;
  change: "improved" | "same" | "declined" | "new";
};

export function compareEvidence(before: SkillEvidence[], after: SkillEvidence[]): SkillComparison[] {
  const prev = new Map(before.map((e) => [e.skillId, e]));
  return after.map((e) => {
    const p = prev.get(e.skillId);
    if (!p) return { skillId: e.skillId, before: null, after: e.percent, change: "new" as const };
    const diff = e.percent - p.percent;
    // Within one item's worth on a small sample is "the same", not a trend.
    const noise = 100 / Math.max(2, Math.min(p.total, e.total));
    return {
      skillId: e.skillId,
      before: p.percent,
      after: e.percent,
      change:
        diff > noise ? ("improved" as const) : diff < -noise ? ("declined" as const) : ("same" as const),
    };
  });
}

// Partial credit for a set-like answer (pairs, groups, blanks, tokens): the share right.
// Choice questions are right or wrong; written answers use their rubric (writing analysis).
export function shareCredit(right: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((1000 * Math.max(0, Math.min(right, total))) / total) / 1000;
}
