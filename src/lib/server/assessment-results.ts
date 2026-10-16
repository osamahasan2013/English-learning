import "server-only";

import { sectionStage, type Domain } from "@/lib/learning/assessment-blueprint";
import {
  compareEvidence,
  isAssessmentGap,
  scoreSections,
  skillEvidence,
  type SittingItem,
  type SkillComparison,
  type SkillEvidence,
} from "@/lib/learning/assessment-evidence";
import type { LearningRules } from "@/lib/learning/rules";
import { scoreLesson } from "@/lib/learning/scoring";
import { clampTimestamp } from "@/lib/learning/progress-derivation";
import type { AssessmentRunEvent, SyncEvent, SyncResult } from "@/lib/offline/sync-protocol";
import { logger } from "@/lib/logging";
import {
  acceptsDeviceSittings,
  loadDefinition,
  loadLevels,
  type AssessmentDefinition,
  type SittingPlan,
} from "@/lib/server/assessment-engine";
import type { StoredSectionScore } from "@/lib/server/readiness";
import type { createAdminClient } from "@/lib/supabase/admin";

// The progress writer's assessment steps (Phase 9). Server only, service role, called after
// the sync route verified the child belongs to the signed-in parent.
//   attachSittings  every event names a sitting the server started for THIS child (or, for
//                   older app versions, a sitting of an assessment that selects nothing);
//   scoreSittings   a finished sitting → evidence per skill (assessment_evidence), the result
//                   (assessment_results: sections, skills, comparison with the sitting it
//                   re-checks), completion and the reward — always from stored first tries.

type Db = ReturnType<typeof createAdminClient>;

export type SittingInfo = {
  id: string;
  assessmentId: string;
  status: "in_progress" | "completed" | "abandoned" | "expired";
  completedAt: string | null;
  // null = every item of the assessment (sittings created by older app versions).
  itemIds: Set<string> | null;
  allowSkip: boolean;
};

export async function attachSittings(
  db: Db,
  childId: string,
  events: SyncEvent[],
  now: Date,
  results: Map<string, SyncResult>,
): Promise<{ events: SyncEvent[]; sittings: Map<string, SittingInfo> }> {
  const sittings = new Map<string, SittingInfo>();
  const sittingOf = (e: SyncEvent) =>
    e.kind === "assessment_run"
      ? { id: e.id, assessmentId: e.assessmentId, at: e.startedAt }
      : e.kind === "attempt" && e.assessmentAttemptId && e.assessmentId
        ? { id: e.assessmentAttemptId, assessmentId: e.assessmentId, at: e.attemptedAt }
        : null;
  const wanted = new Map<string, { assessmentId: string; at: string }>();
  for (const e of events) {
    const s = sittingOf(e);
    if (!s) continue;
    const at = clampTimestamp(s.at, now);
    const prev = wanted.get(s.id);
    if (!prev || at < prev.at) wanted.set(s.id, { assessmentId: prev?.assessmentId ?? s.assessmentId, at });
  }
  if (wanted.size === 0) return { events, sittings };

  const ids = [...wanted.keys()];
  const assessmentIds = [...new Set([...wanted.values()].map((w) => w.assessmentId))];
  const definitions = new Map<string, AssessmentDefinition>();
  for (const id of assessmentIds) {
    const d = await loadDefinition(db, { id });
    if (d) definitions.set(id, d);
  }
  const select = "id, child_id, assessment_id, status, completed_at, item_ids";
  const { data: existing, error } = await db.from("assessment_attempts").select(select).in("id", ids);
  if (error) throw error;

  const bad = new Map<string, string>();
  const register = (row: NonNullable<typeof existing>[number]) => {
    const definition = definitions.get(row.assessment_id);
    if (row.child_id !== childId || row.assessment_id !== wanted.get(row.id)?.assessmentId) {
      bad.set(row.id, "assessment_attempt_not_owned");
      return;
    }
    if (!definition) {
      bad.set(row.id, "unknown_assessment");
      return;
    }
    sittings.set(row.id, {
      id: row.id,
      assessmentId: row.assessment_id,
      status: row.status as SittingInfo["status"],
      completedAt: row.completed_at,
      itemIds: row.item_ids?.length ? new Set(row.item_ids) : null,
      allowSkip: definition.blueprint.allowSkip,
    });
  };
  for (const row of existing ?? []) register(row);

  // Sittings the server never started: only for assessments that select nothing (every
  // authored item), as older app versions created them. Anything else is refused.
  const placeholders = ids
    .filter((id) => !sittings.has(id) && !bad.has(id))
    .flatMap((id) => {
      const w = wanted.get(id)!;
      const definition = definitions.get(w.assessmentId);
      if (!definition) {
        bad.set(id, "unknown_assessment");
        return [];
      }
      if (!acceptsDeviceSittings(definition)) {
        bad.set(id, "sitting_not_started");
        return [];
      }
      return [
        {
          id,
          child_id: childId,
          assessment_id: w.assessmentId,
          assessment_version: definition.version,
          purpose: definition.type,
          started_at: w.at,
          status: "in_progress",
          origin: "sync",
          last_activity_at: now.toISOString(),
        },
      ];
    });
  if (placeholders.length > 0) {
    const { error: insertError } = await db
      .from("assessment_attempts")
      .upsert(placeholders, { onConflict: "id", ignoreDuplicates: true });
    if (insertError) throw insertError;
    // A concurrent request for another child could have won the insert: re-check.
    const { data: after, error: afterError } = await db
      .from("assessment_attempts")
      .select(select)
      .in(
        "id",
        placeholders.map((p) => p.id),
      );
    if (afterError) throw afterError;
    for (const row of after ?? []) register(row);
  }
  if (bad.size > 0) logger.warn("sync.assessment_attempt_rejected", { childId, count: bad.size });
  return {
    sittings,
    events: events.filter((e) => {
      const s = sittingOf(e);
      const reason = s ? bad.get(s.id) : undefined;
      if (reason) results.set(e.id, { id: e.id, status: "rejected", reason });
      return !reason;
    }),
  };
}

// Why an answer in a sitting cannot be stored, if it cannot.
export function sittingRejection(
  sitting: SittingInfo | undefined,
  questionId: string,
  attemptedAt: string,
  legacyItems: Set<string>,
): string | null {
  if (!sitting) return "unknown_sitting";
  if (sitting.status === "abandoned" || sitting.status === "expired") return "sitting_closed";
  if (sitting.status === "completed" && sitting.completedAt && attemptedAt > sitting.completedAt)
    return "sitting_closed";
  if (
    sitting.itemIds
      ? !sitting.itemIds.has(questionId)
      : !legacyItems.has(`${sitting.assessmentId}:${questionId}`)
  )
    return "question_not_in_sitting";
  return null;
}

export type ScoredSittings = {
  skillIds: Set<string>;
  sessionIds: Set<string>;
  assessedAt: Map<string, string>;
  attemptIds: string[];
};

export async function scoreSittings(
  db: Db,
  childId: string,
  runs: AssessmentRunEvent[],
  now: Date,
  results: Map<string, SyncResult>,
  rules: LearningRules,
): Promise<ScoredSittings> {
  const out: ScoredSittings = {
    skillIds: new Set(),
    sessionIds: new Set(),
    assessedAt: new Map(),
    attemptIds: [],
  };
  if (runs.length === 0) return out;
  const { data: done, error } = await db
    .from("assessment_results")
    .select("assessment_attempt_id")
    .in(
      "assessment_attempt_id",
      runs.map((s) => s.id),
    );
  if (error) throw error;
  const already = new Set((done ?? []).map((r) => r.assessment_attempt_id));
  const levels = await loadLevels(db);

  for (const run of runs) {
    if (already.has(run.id)) {
      results.set(run.id, { id: run.id, status: "duplicate" });
      continue;
    }
    const { data: sitting, error: sittingError } = await db
      .from("assessment_attempts")
      .select("id, assessment_id, status, item_ids, scope, started_at, previous_attempt_id")
      .eq("id", run.id)
      .eq("child_id", childId)
      .maybeSingle();
    if (sittingError) throw sittingError;
    const definition = sitting
      ? await loadDefinition(db, { id: sitting.assessment_id }, { publishedOnly: false })
      : null;
    if (!sitting || !definition) {
      results.set(run.id, { id: run.id, status: "rejected", reason: "unknown_assessment" });
      continue;
    }
    const closed = sitting.status === "abandoned" || sitting.status === "expired";
    if (closed && !definition.blueprint.allowPartial) {
      results.set(run.id, { id: run.id, status: "rejected", reason: "sitting_closed" });
      continue;
    }

    // The sitting's items with their section, domain and level.
    const passPercent = definition.blueprint.passPercent ?? rules.assessment.sectionPassPercent;
    type Meta = {
      questionId: string;
      section: string;
      label: string;
      domain: Domain;
      levelId: string | null;
      rank: number;
    };
    let metas: Meta[];
    const plan = (sitting.scope ?? {}) as Partial<SittingPlan>;
    if (sitting.item_ids?.length && plan.items && plan.sections) {
      const sections = new Map(plan.sections.map((s) => [s.code, s]));
      metas = plan.items.flatMap((i) => {
        const s = sections.get(i.s);
        return s
          ? [
              {
                questionId: i.q,
                section: s.code,
                label: s.label,
                domain: s.domain,
                levelId: s.levelId,
                rank: s.rank,
              },
            ]
          : [];
      });
    } else {
      metas = definition.blueprint.sections.flatMap((section) => {
        const level = levels.find((l) => l.code === section.level);
        return definition.items
          .filter((i) => i.stage === sectionStage(definition.blueprint, section))
          .map((i) => ({
            questionId: i.questionId,
            section: section.code,
            label: section.label,
            domain: section.domain,
            levelId: level?.id ?? i.levelId,
            rank: level?.rank ?? 1,
          }));
      });
    }
    const questionIds = metas.map((m) => m.questionId);
    const [questions, tries, prior] = await Promise.all([
      db.from("questions").select("id, skill_id").in("id", questionIds),
      db
        .from("activity_attempts")
        .select("question_id, is_correct, partial_credit, error_type")
        .eq("child_id", childId)
        .eq("assessment_attempt_id", run.id)
        .eq("attempt_number", 1),
      db
        .from("activity_attempts")
        .select("question_id")
        .eq("child_id", childId)
        .in("question_id", questionIds)
        .lt("attempted_at", sitting.started_at),
    ]);
    if (questions.error || tries.error || prior.error) throw questions.error ?? tries.error ?? prior.error;
    const answered = new Map((tries.data ?? []).map((t) => [t.question_id, t]));
    if (answered.size === 0) {
      results.set(run.id, { id: run.id, status: "rejected", reason: "no_attempts_for_run" });
      continue;
    }
    const skillOf = new Map((questions.data ?? []).map((q) => [q.id, q.skill_id]));
    const exposures = new Map<string, number>();
    for (const p of prior.data ?? []) exposures.set(p.question_id, (exposures.get(p.question_id) ?? 0) + 1);

    const items: SittingItem[] = metas.flatMap((m) => {
      const skillId = skillOf.get(m.questionId);
      if (!skillId) return [];
      const t = answered.get(m.questionId);
      const outcome: SittingItem["outcome"] = !t
        ? "unanswered"
        : t.error_type === "skipped"
          ? "skipped"
          : t.is_correct
            ? "correct"
            : "incorrect";
      return [
        {
          questionId: m.questionId,
          sectionCode: m.section,
          domain: m.domain,
          levelId: m.levelId,
          levelRank: m.rank,
          skillId,
          outcome,
          credit: t ? Number(t.partial_credit ?? (t.is_correct ? 1 : 0)) : 0,
          priorExposures: exposures.get(m.questionId) ?? 0,
        },
      ];
    });
    const sections = scoreSections(items, passPercent, rules.assessment);
    const evidence = skillEvidence(items, rules.assessment);
    const labels = new Map(metas.map((m) => [m.section, m.label]));
    const observed = items.filter((i) => i.outcome !== "unanswered");
    const weight = sections.reduce((t, s) => t + s.weight, 0);
    const overall =
      weight > 0 ? (sections.reduce((t, s) => t + (s.percent * s.weight) / 100, 0) * 100) / weight : 0;

    let comparison: { previousAttemptId: string; skills: SkillComparison[] } | null = null;
    if (sitting.previous_attempt_id) {
      const before = await loadEvidence(db, sitting.previous_attempt_id, levels);
      comparison = {
        previousAttemptId: sitting.previous_attempt_id,
        skills: compareEvidence(before, evidence),
      };
    }

    const completedAt = clampTimestamp(run.completedAt, now);
    if (evidence.length > 0) {
      const { error: evidenceError } = await db.from("assessment_evidence").upsert(
        evidence.map((e) => ({
          assessment_attempt_id: run.id,
          child_id: childId,
          skill_id: e.skillId,
          domain: e.domain,
          level_id: e.levelId,
          items_total: e.total,
          items_correct: e.correct,
          items_skipped: e.skipped,
          credit: e.credit,
          weight: e.weight,
          strength: e.strength,
          observed_at: completedAt,
        })),
        { onConflict: "assessment_attempt_id,skill_id", ignoreDuplicates: true },
      );
      if (evidenceError) throw evidenceError;
    }
    const dimensionScores: Record<string, StoredSectionScore> = {};
    sections.forEach((s, order) => {
      const { sectionCode, ...rest } = s;
      dimensionScores[sectionCode] = { ...rest, label: labels.get(sectionCode) ?? sectionCode, order };
    });
    const { error: resultError } = await db.from("assessment_results").upsert(
      {
        assessment_attempt_id: run.id,
        child_id: childId,
        overall_score: Math.round(overall * 100) / 100,
        dimension_scores: dimensionScores,
        skill_scores: Object.fromEntries(
          evidence.map((e) => [
            e.skillId,
            { correct: e.correct, total: e.total, percent: e.percent, strength: e.strength },
          ]),
        ),
        evidence_summary: evidence.map((e) => ({
          skillId: e.skillId,
          domain: e.domain,
          correct: e.correct,
          total: e.total,
          skipped: e.skipped,
          percent: e.percent,
          strength: e.strength,
          gap: isAssessmentGap(e, rules.assessment),
        })),
        partial: closed,
        comparison,
      },
      { onConflict: "assessment_attempt_id", ignoreDuplicates: true },
    );
    if (resultError) throw resultError;
    if (!closed) {
      const { error: attemptError } = await db
        .from("assessment_attempts")
        .update({ completed_at: completedAt, status: "completed", last_activity_at: now.toISOString() })
        .eq("id", run.id)
        .eq("child_id", childId);
      if (attemptError) throw attemptError;
    }
    // Effort is rewarded the same way as a lesson (stars from the share right); a check
    // never takes stars away.
    const score = scoreLesson(
      observed.map((i) => ({ isCorrect: i.outcome === "correct" })),
      rules.scoring,
    );
    const { error: rewardError } = await db
      .from("reward_events")
      .upsert(
        {
          child_id: childId,
          source_type: "assessment",
          source_id: run.id,
          points: score.points,
          stars: score.stars,
        },
        { onConflict: "child_id,source_type,source_id", ignoreDuplicates: true },
      );
    if (rewardError) throw rewardError;
    results.set(run.id, { id: run.id, status: "stored" });
    logger.info("assessment.scored", {
      attemptId: run.id,
      childId,
      items: observed.length,
      sections: sections.length,
    });
    out.attemptIds.push(run.id);
    for (const e of evidence) {
      out.skillIds.add(e.skillId);
      if (!out.assessedAt.has(e.skillId) || out.assessedAt.get(e.skillId)! < completedAt)
        out.assessedAt.set(e.skillId, completedAt);
    }
    if (run.sessionId) out.sessionIds.add(run.sessionId);
  }
  return out;
}

async function loadEvidence(
  db: Db,
  attemptId: string,
  levels: { id: string; rank: number }[],
): Promise<SkillEvidence[]> {
  const { data, error } = await db
    .from("assessment_evidence")
    .select("skill_id, domain, level_id, items_total, items_correct, items_skipped, credit, weight, strength")
    .eq("assessment_attempt_id", attemptId);
  if (error) throw error;
  return (data ?? []).map((e) => {
    const weight = Number(e.weight);
    const credit = Number(e.credit);
    return {
      skillId: e.skill_id,
      domain: e.domain as Domain,
      levelId: e.level_id,
      levelRank: levels.find((l) => l.id === e.level_id)?.rank ?? 1,
      total: e.items_total,
      correct: e.items_correct,
      skipped: e.items_skipped,
      credit,
      weight,
      percent: weight > 0 ? Math.round((10000 * credit) / weight) / 100 : 0,
      strength: e.strength as SkillEvidence["strength"],
    };
  });
}

// Open assessment gaps for these skills (rules.assessment.gap): the latest evidence of each
// skill within the lookback is a gap and the skill is not secure in practice since.
export async function openGaps(db: Db, childId: string, skillIds: string[], now: Date, rules: LearningRules) {
  const gaps = new Map<string, { observedAt: string; percent: number }>();
  if (skillIds.length === 0) return gaps;
  const since = new Date(now.getTime() - rules.assessment.gap.lookbackDays * 86400_000).toISOString();
  const { data, error } = await db
    .from("assessment_evidence")
    .select("skill_id, credit, weight, observed_at")
    .eq("child_id", childId)
    .in("skill_id", skillIds)
    .gte("observed_at", since)
    .order("observed_at", { ascending: false });
  if (error) throw error;
  const latest = new Set<string>();
  for (const e of data ?? []) {
    if (latest.has(e.skill_id)) continue;
    latest.add(e.skill_id);
    const weight = Number(e.weight);
    const percent = weight > 0 ? (100 * Number(e.credit)) / weight : 0;
    if (isAssessmentGap({ weight, percent }, rules.assessment))
      gaps.set(e.skill_id, { observedAt: e.observed_at, percent: Math.round(percent * 100) / 100 });
  }
  return gaps;
}
