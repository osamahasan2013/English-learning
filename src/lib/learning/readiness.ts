import type { Domain } from "@/lib/learning/assessment-blueprint";
import type { SectionResult, SkillEvidence } from "@/lib/learning/assessment-evidence";
import { masteryRank, type MasteryStatus } from "@/lib/learning/mastery";
import {
  CONFIDENCE_LEVELS,
  DEFAULT_RULES,
  type AssessmentRules,
  type Confidence,
} from "@/lib/learning/rules";

// Instructional readiness per domain (Phase 9, ADR-047): where to TEACH this child in
// phonics, reading, vocabulary, spelling and writing — each on its own, never averaged.
// It is not the school grade (children.grade_level_id never changes) and not mastery
// (skill_mastery stays the per-skill record). Pure and explainable: every result carries
// the evidence it rests on and a confidence from a fixed rule (docs/curriculum.md →
// "Assessment and readiness").
//
// Levels are ranks (KG1 = 1 … GRADE2 = 5). A level is SECURE when
//   * a completed assessment passed its section for this domain at that level, or
//   * every level below the lowest section the child passed (placed above them — the same
//     assumption the prerequisite rules make), or
//   * practice shows it: the advancement rule (rules.advancement) on skill mastery — a share
//     of the level's skills ALMOST_MASTERED/MASTERED and none weak. Completing lessons alone
//     never secures a level.
// strongest = the highest secure level with every level below it secure;
// current   = the level after it (where teaching happens), or the top level;
// next      = the level after current.

export type LevelRef = { id: string; code: string; rank: number };

export type MasteryFact = {
  skillId: string;
  domain: Domain;
  levelRank: number;
  status: MasteryStatus;
  masteryScore: number;
  attempts: number;
  weak: boolean;
};

export type ReadinessInput = {
  domain: Domain;
  levels: LevelRef[];
  // The child's learning level (children.current_level_id): used when there is no evidence.
  defaultRank: number;
  // Sections of the latest completed sitting that measured this domain (empty if none).
  sections: SectionResult[];
  // That sitting's per-skill evidence for this domain, and when it was observed.
  evidence: SkillEvidence[];
  observedAt: string | null;
  // Active skills of this domain with the child's mastery (skills never practised included,
  // with status NOT_STARTED and 0 attempts).
  mastery: MasteryFact[];
  skillTitles: ReadonlyMap<string, string>;
  // Prerequisite links (skill → its prerequisite skills), for the gaps.
  prerequisites: ReadonlyMap<string, string[]>;
  now: Date;
  rules?: AssessmentRules;
};

export type Readiness = {
  domain: Domain;
  currentRank: number;
  strongestRank: number | null;
  nextRank: number | null;
  confidence: Confidence;
  source: "assessment" | "mastery" | "inferred" | "default";
  evidence: {
    sections: { levelRank: number; items: number; correct: number; percent: number; passed: boolean }[];
    assumedBelowRank: number | null;
    securedByPractice: number[];
    items: number;
    skills: number;
    observedAt: string | null;
    consistent: boolean;
    reason: string;
  };
  strengths: { skillId: string; title: string; detail: string }[];
  needs: { skillId: string; title: string; detail: string }[];
  prerequisiteGaps: { skillId: string; title: string; forSkillId: string; forTitle: string }[];
};

const stepDown = (c: Confidence): Confidence =>
  CONFIDENCE_LEVELS[Math.max(0, CONFIDENCE_LEVELS.indexOf(c) - 1)];
export const confidenceRank = (c: Confidence) => CONFIDENCE_LEVELS.indexOf(c);

// How parents see the value (Phase 9.1): it is a deterministic count of the answers and
// skills a level rests on, not a statistical confidence, so the words say "evidence".
export const EVIDENCE_LABELS: Readonly<Record<Confidence, string>> = {
  INSUFFICIENT: "Not enough evidence yet",
  LOW: "Limited evidence",
  MEDIUM: "Moderate evidence",
  HIGH: "Strong evidence",
};
const DAY_MS = 24 * 60 * 60 * 1000;

// The advancement rule: is this domain level secured by practice?
export function securedByPractice(
  facts: MasteryFact[],
  rank: number,
  rules: AssessmentRules = DEFAULT_RULES.assessment,
) {
  const atLevel = facts.filter((f) => f.levelRank === rank);
  if (atLevel.length === 0) return false;
  const a = rules.advancement;
  const secured = atLevel.filter(
    (f) => masteryRank(f.status) >= masteryRank("ALMOST_MASTERED") && f.attempts >= a.minAttempts,
  );
  const weak = atLevel.some((f) => f.weak);
  return (
    secured.length >= Math.min(a.minSkills, atLevel.length) &&
    secured.length / atLevel.length >= a.securedShare &&
    !weak
  );
}

// Share of a level's skills secured by practice (for "stretch").
export function practiceCoverage(
  facts: MasteryFact[],
  rank: number,
  rules: AssessmentRules = DEFAULT_RULES.assessment,
) {
  const atLevel = facts.filter((f) => f.levelRank === rank);
  if (atLevel.length === 0) return 0;
  return (
    atLevel.filter(
      (f) =>
        masteryRank(f.status) >= masteryRank("ALMOST_MASTERED") &&
        f.attempts >= rules.advancement.minAttempts,
    ).length / atLevel.length
  );
}

export function computeReadiness(input: ReadinessInput): Readiness {
  const rules = input.rules ?? DEFAULT_RULES.assessment;
  const ranks = input.levels.map((l) => l.rank).sort((a, b) => a - b);
  const [minRank, maxRank] = [ranks[0], ranks.at(-1)!];
  const served = input.sections.filter((s) => s.served).sort((a, b) => a.levelRank - b.levelRank);
  const passedRanks = new Set(served.filter((s) => s.passed).map((s) => s.levelRank));
  const failedRanks = new Set(served.filter((s) => !s.passed).map((s) => s.levelRank));
  // Consistent: no level passed above a level failed.
  const consistent = ![...passedRanks].some((p) => [...failedRanks].some((f) => f < p));

  let strongest: number | null = null;
  let assumedBelowRank: number | null = null;
  let source: Readiness["source"] = "default";
  let reason = "";

  if (served.length > 0) {
    source = "assessment";
    const lowestServed = served[0].levelRank;
    const lowestPassed = passedRanks.has(lowestServed);
    if (lowestPassed && lowestServed > minRank) assumedBelowRank = lowestServed;
    for (const r of ranks) {
      const secure = (r < lowestServed && lowestPassed) || passedRanks.has(r);
      if (!secure) break;
      strongest = r;
    }
    reason =
      strongest === null
        ? `The check at ${rankLabel(input.levels, lowestServed)} was not secure yet.`
        : `Secure up to ${rankLabel(input.levels, strongest)} on the check.`;
  } else {
    // No assessment: the learning level is the starting point, the levels below it assumed.
    strongest = input.defaultRank > minRank ? input.defaultRank - 1 : null;
    reason = "No check yet: teaching starts at the child's learning level.";
  }

  // Advancement through practice beyond what the check showed.
  const securedByPracticeRanks: number[] = [];
  for (let r = (strongest ?? minRank - 1) + 1; r <= maxRank; r++) {
    if (!securedByPractice(input.mastery, r, rules)) break;
    strongest = r;
    securedByPracticeRanks.push(r);
  }
  if (securedByPracticeRanks.length > 0) {
    if (source === "default") source = "mastery";
    reason += ` Practice has secured ${securedByPracticeRanks.map((r) => rankLabel(input.levels, r)).join(", ")}.`;
  }

  const currentRank =
    strongest === null
      ? served.length
        ? served[0].levelRank
        : input.defaultRank
      : Math.min(strongest + 1, maxRank);
  const nextRank = currentRank < maxRank ? currentRank + 1 : null;

  // Confidence.
  let confidence: Confidence = "INSUFFICIENT";
  let items = 0;
  let skills = 0;
  if (source === "assessment") {
    const deciding = served.filter((s) => s.levelRank === strongest || s.levelRank === currentRank);
    const pool = deciding.length > 0 ? deciding : served;
    // Only ANSWERED items make the engine sure: "I don't know" counts as not right (the
    // section is not passed) but adds no certainty, so a check answered mostly with skips
    // stays INSUFFICIENT and teaching stays at the learning level (Phase 9.1).
    const answeredWeight = (s: SectionResult) =>
      s.items > 0 ? (s.weight * (s.items - s.skipped)) / s.items : 0;
    items = Math.round(pool.reduce((t, s) => t + answeredWeight(s), 0) * 100) / 100;
    skills = new Set(pool.filter((s) => s.items > s.skipped).flatMap((s) => s.skills)).size;
    const c = rules.confidence;
    confidence =
      items >= c.highItems && skills >= c.highSkills
        ? "HIGH"
        : items >= c.mediumItems && skills >= c.mediumSkills
          ? "MEDIUM"
          : items >= c.lowItems
            ? "LOW"
            : "INSUFFICIENT";
    if (!consistent) confidence = stepDown(confidence);
    const observed = input.observedAt ? Date.parse(input.observedAt) : NaN;
    if (Number.isFinite(observed) && input.now.getTime() - observed > rules.confidence.recentDays * DAY_MS)
      confidence = stepDown(confidence);
  }
  if (securedByPracticeRanks.length > 0) {
    // The deciding evidence is practice: secured skills at the highest secured level.
    const top = securedByPracticeRanks.at(-1)!;
    const securedSkills = input.mastery.filter(
      (f) => f.levelRank === top && masteryRank(f.status) >= masteryRank("ALMOST_MASTERED"),
    ).length;
    const c = rules.confidence;
    const fromPractice: Confidence =
      securedSkills > c.highSkills ? "HIGH" : securedSkills >= c.mediumSkills ? "MEDIUM" : "LOW";
    // The newest claim (a level secured by practice) decides how sure the engine is.
    confidence = fromPractice;
    skills = Math.max(skills, securedSkills);
  }

  // Strengths and needs (skills of this domain, never across domains).
  const title = (id: string) => input.skillTitles.get(id) ?? "";
  const strengths = [
    ...input.evidence
      .filter((e) => e.strength === "secure")
      .map((e) => ({
        skillId: e.skillId,
        title: title(e.skillId),
        detail: `${e.correct} of ${e.total} right on the check`,
        score: 200 + e.percent,
      })),
    ...input.mastery
      .filter((f) => f.status === "MASTERED")
      .map((f) => ({
        skillId: f.skillId,
        title: title(f.skillId),
        detail: "Mastered in practice",
        score: 100 + f.masteryScore,
      })),
  ];
  const needs = [
    ...input.evidence
      .filter((e) => e.strength === "weak" || e.strength === "developing")
      .map((e) => ({
        skillId: e.skillId,
        title: title(e.skillId),
        detail: `${e.correct} of ${e.total} right on the check`,
        score: 200 - e.percent,
      })),
    ...input.mastery
      .filter((f) => f.weak && f.levelRank <= currentRank)
      .map((f) => ({
        skillId: f.skillId,
        title: title(f.skillId),
        detail: "Needs more practice",
        score: 100 - f.masteryScore,
      })),
  ];
  const top3 = (list: typeof strengths) => {
    const seen = new Set<string>();
    return list
      .sort((a, b) => b.score - a.score || (a.skillId < b.skillId ? -1 : 1))
      .filter((x) => (seen.has(x.skillId) ? false : (seen.add(x.skillId), true)))
      .slice(0, 3)
      .map(({ skillId, title, detail }) => ({ skillId, title, detail }));
  };
  const needList = top3(needs);
  const needIds = new Set(needs.map((n) => n.skillId));

  // Prerequisite gaps: a weak skill that is a prerequisite of a skill at the current level.
  const prerequisiteGaps: Readiness["prerequisiteGaps"] = [];
  for (const f of input.mastery.filter((m) => m.levelRank === currentRank))
    for (const pre of input.prerequisites.get(f.skillId) ?? [])
      if (needIds.has(pre) && !prerequisiteGaps.some((g) => g.skillId === pre))
        prerequisiteGaps.push({
          skillId: pre,
          title: title(pre),
          forSkillId: f.skillId,
          forTitle: title(f.skillId),
        });

  return {
    domain: input.domain,
    currentRank,
    strongestRank: strongest,
    nextRank,
    confidence,
    source,
    evidence: {
      sections: served.map((s) => ({
        levelRank: s.levelRank,
        items: s.items,
        correct: s.correct,
        percent: s.percent,
        passed: s.passed,
      })),
      assumedBelowRank,
      securedByPractice: securedByPracticeRanks,
      items,
      skills,
      observedAt: input.observedAt,
      consistent,
      reason: reason.trim(),
    },
    strengths: top3(strengths),
    needs: needList,
    prerequisiteGaps: prerequisiteGaps.slice(0, 5),
  };
}

// Cross-domain evidence (rules.inferFromPhonics): reading and spelling with no evidence of
// their own may start from the phonics level (decoding and encoding rest on it), marked
// "inferred" with LOW confidence. Nothing is marked mastered in another domain.
export function inferFromPhonics(
  byDomain: Map<Domain, Readiness>,
  rules: AssessmentRules = DEFAULT_RULES.assessment,
) {
  const phonics = byDomain.get("PHONICS");
  if (!rules.inferFromPhonics || !phonics || confidenceRank(phonics.confidence) < confidenceRank("MEDIUM"))
    return;
  for (const domain of ["READING", "SPELLING"] as const) {
    const r = byDomain.get(domain);
    if (!r || r.source !== "default") continue;
    byDomain.set(domain, {
      ...r,
      currentRank: phonics.currentRank,
      strongestRank: phonics.strongestRank,
      nextRank: phonics.nextRank,
      confidence: "LOW",
      source: "inferred",
      evidence: { ...r.evidence, reason: "No check in this area yet: starting from the phonics level." },
    });
  }
}

function rankLabel(levels: LevelRef[], rank: number) {
  return levels.find((l) => l.rank === rank)?.code ?? `level ${rank}`;
}
