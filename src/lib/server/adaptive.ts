import "server-only";

import { cache } from "react";
import {
  recommend,
  type AdaptiveDomain,
  type AdaptiveGap,
  type AdaptiveLesson,
  type AdaptiveLessonState,
  type AdaptiveRecommendation,
  type AdaptiveReview,
  type AdaptiveSkill,
} from "@/lib/learning/adaptive";
import { DOMAIN_NAMES, DOMAINS, SUBJECT_DOMAIN, type Domain } from "@/lib/learning/assessment-blueprint";
import { isAssessmentGap } from "@/lib/learning/assessment-evidence";
import { buildDailyPlan, type PlanItem } from "@/lib/learning/daily-plan";
import { masteryRank, type MasteryStatus } from "@/lib/learning/mastery";
import { confidenceRank } from "@/lib/learning/readiness";
import type { ReviewReason } from "@/lib/learning/review-queue";
import type { Confidence } from "@/lib/learning/rules";
import { ChildNotFoundError } from "@/lib/server/learning-engine";
import { loadLearningRules } from "@/lib/server/learning-rules";
import { recomputeReadiness } from "@/lib/server/readiness";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Loads everything the adaptive engine (src/lib/learning/adaptive.ts) needs for one child
// and runs it: the ONE place recommendations come from for the child home, the daily plan
// and the parent dashboard (ADR-048). Reads use the parent's RLS client (another family's
// child is not found). Readiness is a stored cache: when it is missing or older than the
// child's last reset or a day, it is recomputed with the service role — after the RLS read
// found the child — exactly as the progress writer does after a sync.

const READINESS_MAX_AGE_MS = 24 * 3600_000;

export type DomainReadiness = {
  domain: Domain;
  name: string;
  levelId: string;
  levelName: string;
  strongestLevelName: string | null;
  nextLevelName: string | null;
  confidence: Confidence;
  source: "assessment" | "mastery" | "inferred" | "default";
  // The level this domain is taught at now (readiness, or the learning level when the
  // readiness is not confident enough).
  teachingLevelId: string;
  teachingLevelName: string;
  // Whether the evidence is strong enough for lessons to follow the readiness level
  // (rules.adaptive.minReadinessConfidence); otherwise teaching stays at the learning level.
  confident: boolean;
  evidence: {
    reason?: string;
    items?: number;
    skills?: number;
    observedAt?: string | null;
    sections?: unknown[];
  };
  strengths: { skillId: string; title: string; detail: string }[];
  needs: { skillId: string; title: string; detail: string }[];
  prerequisiteGaps: { skillId: string; title: string; forTitle: string }[];
  computedAt: string;
};

export type AdaptiveView = {
  recommendations: AdaptiveRecommendation[];
  plan: PlanItem[];
  readiness: DomainReadiness[];
};

export const loadAdaptive = cache(async (childId: string, now = new Date()): Promise<AdaptiveView> => {
  if (!/^[0-9a-f-]{36}$/i.test(childId)) throw new ChildNotFoundError();
  const supabase = await createClient();
  const { data: child } = await supabase
    .from("children")
    .select("id, current_level_id, daily_minutes, learning_reset_at")
    .eq("id", childId)
    .maybeSingle();
  if (!child) throw new ChildNotFoundError();
  const rules = await loadLearningRules(supabase);

  const readReadiness = () =>
    supabase
      .from("instructional_readiness")
      .select(
        "domain, current_level_id, strongest_level_id, next_level_id, confidence, source, evidence, strengths, needs, prerequisite_gaps, computed_at",
      )
      .eq("child_id", child.id);
  let { data: readinessRows, error: readinessError } = await readReadiness();
  if (readinessError) throw readinessError;
  const stale =
    (readinessRows ?? []).length < DOMAINS.length ||
    (readinessRows ?? []).some(
      (r) =>
        now.getTime() - Date.parse(r.computed_at) > READINESS_MAX_AGE_MS ||
        (child.learning_reset_at && r.computed_at < child.learning_reset_at),
    );
  if (stale) {
    await recomputeReadiness(createAdminClient(), child.id, now, rules);
    ({ data: readinessRows, error: readinessError } = await readReadiness());
    if (readinessError) throw readinessError;
  }

  const { data: levelRows, error: levelError } = await supabase
    .from("levels")
    .select("id, code, name, sort_order")
    .eq("status", "published")
    .order("sort_order");
  if (levelError) throw levelError;
  const levels = (levelRows ?? []).map((l, i) => ({ id: l.id, code: l.code, name: l.name, rank: i + 1 }));
  const level = (id: string | null) => levels.find((l) => l.id === id) ?? null;
  const defaultLevel = level(child.current_level_id) ?? levels[0];

  const readiness: DomainReadiness[] = DOMAINS.map((domain) => {
    const r = (readinessRows ?? []).find((x) => x.domain === domain);
    const confidence = (r?.confidence ?? "INSUFFICIENT") as Confidence;
    const confident = confidenceRank(confidence) >= confidenceRank(rules.adaptive.minReadinessConfidence);
    const current = level(r?.current_level_id ?? null) ?? defaultLevel;
    const teaching = confident ? current : defaultLevel;
    return {
      domain,
      name: DOMAIN_NAMES[domain],
      levelId: current.id,
      levelName: current.name,
      strongestLevelName: level(r?.strongest_level_id ?? null)?.name ?? null,
      nextLevelName: level(r?.next_level_id ?? null)?.name ?? null,
      confidence,
      source: (r?.source ?? "default") as DomainReadiness["source"],
      teachingLevelId: teaching.id,
      teachingLevelName: teaching.name,
      confident,
      evidence: (r?.evidence ?? {}) as DomainReadiness["evidence"],
      strengths: (r?.strengths ?? []) as DomainReadiness["strengths"],
      needs: (r?.needs ?? []) as DomainReadiness["needs"],
      prerequisiteGaps: (r?.prerequisite_gaps ?? []) as DomainReadiness["prerequisiteGaps"],
      computedAt: r?.computed_at ?? now.toISOString(),
    };
  });

  // The paths: each domain's teaching level and the level after it (for stretch).
  const rankOf = (id: string) => level(id)?.rank ?? 1;
  const levelIds = new Set<string>();
  for (const r of readiness) {
    levelIds.add(r.teachingLevelId);
    const next = levels.find((l) => l.rank === rankOf(r.teachingLevelId) + 1);
    if (next) levelIds.add(next.id);
  }
  const catalogColumns =
    "lesson_id, lesson_title, lesson_child_title, lesson_emoji, estimated_minutes, skill_id, skill_title, skill_child_title, skill_active, skill_importance, subject_code, subject_name, level_id, unit_order, skill_order, lesson_order";
  const [catalog, progress, mastery, reviews, links] = await Promise.all([
    supabase
      .from("lesson_catalog")
      .select(catalogColumns)
      .in("level_id", [...levelIds])
      .order("unit_order")
      .order("skill_order")
      .order("lesson_order"),
    supabase.from("lesson_progress").select("lesson_id, status, last_completed_at").eq("child_id", child.id),
    supabase
      .from("skill_mastery")
      .select(
        "skill_id, status, mastery_score, attempts, skills(title, child_title, importance, units(level_id, subjects(code)))",
      )
      .eq("child_id", child.id),
    supabase
      .from("review_items")
      .select("item_key, skill_id, lesson_id, reason, priority, due_at")
      .eq("child_id", child.id)
      .eq("status", "open")
      .order("priority", { ascending: false })
      .limit(50),
    supabase.from("skill_prerequisites").select("skill_id, prerequisite_skill_id"),
  ]);
  for (const r of [catalog, progress, mastery, reviews, links]) if (r.error) throw r.error;

  type CatalogRow = NonNullable<typeof catalog.data>[number];
  const toLesson = (l: CatalogRow, i: number): AdaptiveLesson => ({
    lessonId: l.lesson_id!,
    title: l.lesson_child_title || l.lesson_title || "",
    emoji: l.lesson_emoji ?? "",
    estimatedMinutes: l.estimated_minutes ?? 5,
    skillId: l.skill_id!,
    domain: SUBJECT_DOMAIN[l.subject_code ?? ""] ?? null,
    levelRank: rankOf(l.level_id!),
    pathOrder: i,
    subjectName: l.subject_name ?? "",
  });
  const lessons = (catalog.data ?? []).filter((l) => l.skill_active !== false).map(toLesson);

  const skills = new Map<string, AdaptiveSkill>();
  for (const l of catalog.data ?? [])
    if (l.skill_id && !skills.has(l.skill_id))
      skills.set(l.skill_id, {
        skillId: l.skill_id,
        title: l.skill_child_title || l.skill_title || "",
        domain: SUBJECT_DOMAIN[l.subject_code ?? ""] ?? null,
        levelRank: rankOf(l.level_id!),
        importance: l.skill_importance ?? 3,
        status: "NOT_STARTED",
        masteryScore: 0,
        attempts: 0,
        recentErrors: 0,
      });
  const recentErrorSkills = new Set(
    (reviews.data ?? []).filter((r) => r.reason === "recent_errors").map((r) => r.skill_id),
  );
  for (const m of mastery.data ?? []) {
    const s = Array.isArray(m.skills) ? m.skills[0] : m.skills;
    const unit = s ? (Array.isArray(s.units) ? s.units[0] : s.units) : null;
    const subject = unit ? (Array.isArray(unit.subjects) ? unit.subjects[0] : unit.subjects) : null;
    skills.set(m.skill_id, {
      skillId: m.skill_id,
      title: s?.child_title || s?.title || "",
      domain: SUBJECT_DOMAIN[subject?.code ?? ""] ?? null,
      levelRank: unit ? rankOf(unit.level_id) : 1,
      importance: s?.importance ?? 3,
      status: m.status as MasteryStatus,
      masteryScore: Number(m.mastery_score),
      attempts: m.attempts,
      recentErrors: recentErrorSkills.has(m.skill_id) ? 2 : 0,
    });
  }
  const prerequisites = new Map<string, string[]>();
  for (const l of links.data ?? [])
    prerequisites.set(l.skill_id, [...(prerequisites.get(l.skill_id) ?? []), l.prerequisite_skill_id]);

  // Assessment gaps still open, with the practice since (for re-checks).
  const since = new Date(now.getTime() - rules.assessment.gap.lookbackDays * 86400_000).toISOString();
  const { data: evidence, error: evidenceError } = await supabase
    .from("assessment_evidence")
    .select("skill_id, credit, weight, observed_at")
    .eq("child_id", child.id)
    .gte("observed_at", since)
    .order("observed_at", { ascending: false })
    .limit(200);
  if (evidenceError) throw evidenceError;
  const latestEvidence = new Map<string, { percent: number; weight: number; observedAt: string }>();
  for (const e of evidence ?? [])
    if (!latestEvidence.has(e.skill_id)) {
      const weight = Number(e.weight);
      latestEvidence.set(e.skill_id, {
        weight,
        percent: weight > 0 ? (100 * Number(e.credit)) / weight : 0,
        observedAt: e.observed_at,
      });
    }
  const gapSkills = [...latestEvidence].filter(
    ([skillId, e]) =>
      isAssessmentGap(e, rules.assessment) &&
      masteryRank(skills.get(skillId)?.status ?? "NOT_STARTED") < masteryRank("ALMOST_MASTERED"),
  );
  const gaps: AdaptiveGap[] = [];
  if (gapSkills.length > 0) {
    const { data: tries, error: triesError } = await supabase
      .from("activity_attempts")
      .select("skill_id, is_correct, attempted_at, assessment_attempt_id")
      .eq("child_id", child.id)
      .eq("attempt_number", 1)
      .in(
        "skill_id",
        gapSkills.map(([id]) => id),
      )
      .gte("attempted_at", gapSkills.map(([, e]) => e.observedAt).sort()[0])
      .limit(1000);
    if (triesError) throw triesError;
    for (const [skillId, e] of gapSkills) {
      const after = (tries ?? []).filter(
        (t) => t.skill_id === skillId && t.attempted_at > e.observedAt && !t.assessment_attempt_id,
      );
      gaps.push({
        skillId,
        percent: e.percent,
        attemptsSince: after.length,
        correctSince: after.filter((t) => t.is_correct).length,
      });
    }
  }

  // The first published lesson for every skill the engine may send the child to practise.
  const wanted = new Set<string>([
    ...[...prerequisites.values()].flat(),
    ...(reviews.data ?? []).map((r) => r.skill_id).filter((id): id is string => !!id),
    ...[...skills.keys()],
  ]);
  const practiceLesson = new Map<string, AdaptiveLesson>();
  for (const l of lessons) if (!practiceLesson.has(l.skillId)) practiceLesson.set(l.skillId, l);
  const missing = [...wanted].filter((id) => !practiceLesson.has(id));
  if (missing.length > 0) {
    const { data: extra, error: extraError } = await supabase
      .from("lesson_catalog")
      .select(catalogColumns)
      .in("skill_id", missing.slice(0, 300))
      .order("lesson_order");
    if (extraError) throw extraError;
    (extra ?? []).forEach((l, i) => {
      if (l.skill_id && !practiceLesson.has(l.skill_id))
        practiceLesson.set(l.skill_id, toLesson(l, 10_000 + i));
    });
  }

  const domains: AdaptiveDomain[] = readiness.map((r) => {
    const rank = rankOf(r.teachingLevelId);
    const atLevel = [...skills.values()].filter((s) => s.domain === r.domain && s.levelRank === rank);
    const secured = atLevel.filter(
      (s) =>
        masteryRank(s.status) >= masteryRank("ALMOST_MASTERED") &&
        s.attempts >= rules.assessment.advancement.minAttempts,
    );
    const next = levels.find((l) => l.rank === rank + 1) ?? null;
    return {
      domain: r.domain,
      rank,
      confidence: r.confidence,
      coverage: atLevel.length ? secured.length / atLevel.length : 0,
      nextRank: next?.rank ?? null,
      levelName: r.teachingLevelName,
      nextLevelName: next?.name ?? null,
    };
  });

  const states = new Map<string, AdaptiveLessonState>(
    (progress.data ?? []).map((p) => [
      p.lesson_id,
      { status: p.status as AdaptiveLessonState["status"], lastCompletedAt: p.last_completed_at },
    ]),
  );
  const recommendations = recommend({
    domains,
    lessons,
    lessonStates: states,
    skills,
    prerequisites,
    practiceLesson,
    reviews: (reviews.data ?? []).map((r): AdaptiveReview => ({
      itemKey: r.item_key,
      skillId: r.skill_id,
      lessonId: r.lesson_id,
      reason: r.reason as ReviewReason,
      priority: Number(r.priority),
      dueAt: r.due_at,
    })),
    gaps,
    now,
    rules: rules.adaptive,
    assessmentRules: rules.assessment,
    reviewRules: rules.review,
  });
  return {
    recommendations,
    plan: buildDailyPlan({ dailyMinutes: child.daily_minutes, recommendations, rules: rules.adaptive }),
    readiness,
  };
});
