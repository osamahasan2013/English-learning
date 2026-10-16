import "server-only";

import { DOMAINS, SUBJECT_DOMAIN, type Domain } from "@/lib/learning/assessment-blueprint";
import type { SectionResult, SkillEvidence } from "@/lib/learning/assessment-evidence";
import {
  computeReadiness,
  inferFromPhonics,
  type LevelRef,
  type MasteryFact,
  type Readiness,
} from "@/lib/learning/readiness";
import type { MasteryStatus } from "@/lib/learning/mastery";
import type { LearningRules } from "@/lib/learning/rules";
import { loadLevels } from "@/lib/server/assessment-engine";
import type { createAdminClient } from "@/lib/supabase/admin";

// Recomputes a child's instructional readiness (instructional_readiness, one row per domain)
// from the latest completed sitting per domain and the child's skill mastery (readiness.ts).
// Server only, service role: called by the progress writer after answers or a sitting were
// stored, and lazily by the adaptive loader after the parent's RLS client found the child.

type Db = ReturnType<typeof createAdminClient>;

// The shape assessment_results.dimension_scores stores per section (Phase 9).
export type StoredSectionScore = Omit<SectionResult, "sectionCode"> & { label: string; order?: number };

export type ReadinessContext = {
  levels: LevelRef[];
  skillTitles: Map<string, string>;
  facts: MasteryFact[];
};

export async function recomputeReadiness(
  db: Db,
  childId: string,
  now: Date,
  rules: LearningRules,
): Promise<Map<Domain, Readiness>> {
  const [
    levels,
    { data: child, error: childError },
    { data: results, error: resultsError },
    skills,
    mastery,
    links,
  ] = await Promise.all([
    loadLevels(db),
    db.from("children").select("current_level_id, learning_epoch").eq("id", childId).maybeSingle(),
    db
      .from("assessment_results")
      .select("assessment_attempt_id, dimension_scores, created_at, partial")
      .eq("child_id", childId)
      .order("created_at", { ascending: false })
      .limit(30),
    db
      .from("skills")
      .select(
        "id, title, child_title, is_active, status, units!inner(level_id, status, subjects!inner(code))",
      )
      .eq("status", "published")
      .eq("is_active", true),
    db.from("skill_mastery").select("skill_id, status, mastery_score, attempts").eq("child_id", childId),
    db.from("skill_prerequisites").select("skill_id, prerequisite_skill_id"),
  ]);
  if (childError || resultsError || skills.error || mastery.error || links.error)
    throw childError ?? resultsError ?? skills.error ?? mastery.error ?? links.error;
  if (!child) throw new Error("child_not_found");
  const rankOf = new Map(levels.map((l) => [l.id, l.rank]));
  const defaultRank = rankOf.get(child.current_level_id) ?? 1;

  // Latest completed sitting that measured each domain.
  const latest = new Map<Domain, { attemptId: string; sections: SectionResult[]; at: string }>();
  for (const r of results ?? []) {
    const sections = Object.entries((r.dimension_scores ?? {}) as Record<string, Partial<StoredSectionScore>>)
      .filter(([, s]) => s && typeof s.domain === "string" && typeof s.levelRank === "number")
      .map(([code, s]) => ({ sectionCode: code, ...(s as StoredSectionScore) }));
    for (const domain of DOMAINS) {
      if (latest.has(domain)) continue;
      const own = sections.filter((s) => s.domain === domain && s.served);
      if (own.length > 0)
        latest.set(domain, { attemptId: r.assessment_attempt_id, sections: own, at: r.created_at });
    }
  }
  const evidenceRows = latest.size
    ? await db
        .from("assessment_evidence")
        .select(
          "assessment_attempt_id, skill_id, domain, level_id, items_total, items_correct, items_skipped, credit, weight, strength",
        )
        .in(
          "assessment_attempt_id",
          [...latest.values()].map((l) => l.attemptId),
        )
    : { data: [], error: null };
  if (evidenceRows.error) throw evidenceRows.error;

  const titles = new Map<string, string>();
  const masteryBySkill = new Map((mastery.data ?? []).map((m) => [m.skill_id, m]));
  const facts: MasteryFact[] = [];
  for (const s of skills.data ?? []) {
    const unit = Array.isArray(s.units) ? s.units[0] : s.units;
    if (!unit || unit.status !== "published") continue;
    const subject = Array.isArray(unit.subjects) ? unit.subjects[0] : unit.subjects;
    const domain = SUBJECT_DOMAIN[subject?.code ?? ""];
    titles.set(s.id, s.child_title || s.title);
    if (!domain) continue;
    const m = masteryBySkill.get(s.id);
    const score = Number(m?.mastery_score ?? 0);
    const attempts = m?.attempts ?? 0;
    facts.push({
      skillId: s.id,
      domain,
      levelRank: rankOf.get(unit.level_id) ?? 1,
      status: (m?.status ?? "NOT_STARTED") as MasteryStatus,
      masteryScore: score,
      attempts,
      weak: attempts >= rules.review.minAttempts && score < rules.review.weakBelowScore,
    });
  }
  const prerequisites = new Map<string, string[]>();
  for (const l of links.data ?? [])
    prerequisites.set(l.skill_id, [...(prerequisites.get(l.skill_id) ?? []), l.prerequisite_skill_id]);

  const byDomain = new Map<Domain, Readiness>();
  for (const domain of DOMAINS) {
    const sitting = latest.get(domain);
    const evidence: SkillEvidence[] = (evidenceRows.data ?? [])
      .filter((e) => sitting && e.assessment_attempt_id === sitting.attemptId && e.domain === domain)
      .map((e) => {
        const weight = Number(e.weight);
        const credit = Number(e.credit);
        return {
          skillId: e.skill_id,
          domain,
          levelId: e.level_id,
          levelRank: rankOf.get(e.level_id ?? "") ?? 1,
          total: e.items_total,
          correct: e.items_correct,
          skipped: e.items_skipped,
          credit,
          weight,
          percent: weight > 0 ? Math.round((10000 * credit) / weight) / 100 : 0,
          strength: e.strength as SkillEvidence["strength"],
        };
      });
    byDomain.set(
      domain,
      computeReadiness({
        domain,
        levels,
        defaultRank,
        sections: sitting?.sections ?? [],
        evidence,
        observedAt: sitting?.at ?? null,
        mastery: facts.filter((f) => f.domain === domain),
        skillTitles: titles,
        prerequisites,
        now,
        rules: rules.assessment,
      }),
    );
  }
  inferFromPhonics(byDomain, rules.assessment);

  const levelId = (rank: number | null) =>
    rank === null ? null : (levels.find((l) => l.rank === rank)?.id ?? null);
  const rows = [...byDomain.values()].map((r) => ({
    child_id: childId,
    domain: r.domain,
    current_level_id: levelId(r.currentRank) ?? child.current_level_id,
    strongest_level_id: levelId(r.strongestRank),
    next_level_id: levelId(r.nextRank),
    confidence: r.confidence,
    source: r.source,
    evidence: r.evidence,
    strengths: r.strengths,
    needs: r.needs,
    prerequisite_gaps: r.prerequisiteGaps,
    assessment_attempt_id: latest.get(r.domain)?.attemptId ?? null,
    learning_epoch: child.learning_epoch,
    computed_at: now.toISOString(),
  }));
  const { error } = await db.from("instructional_readiness").upsert(rows, { onConflict: "child_id,domain" });
  if (error) throw error;
  return byDomain;
}
