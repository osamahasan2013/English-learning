import "server-only";

import { cache } from "react";
import { DOMAINS, type Domain } from "@/lib/learning/assessment-blueprint";
import {
  answerTrend,
  buildParentDashboard,
  domainSnapshot,
  homeGuidance,
  levelLines,
  practiceView,
  type ParentDashboardViewModel,
  type ParentSkill,
  type Trend,
} from "@/lib/parent/view-model";
import { loadAdaptive } from "@/lib/server/adaptive";
import { loadOpenSittings, loadSittingHistory } from "@/lib/server/assessments";
import {
  listChildren,
  loadChildProgress,
  loadSkillProgress,
  type ChildWithLevel,
} from "@/lib/server/family-data";
import { loadLearningRules } from "@/lib/server/learning-rules";
import { createClient } from "@/lib/supabase/server";

// Server side of the parent experience (Phase 10, ADR-050). It only COMPOSES the existing
// loaders — every one of them reads with the signed-in parent's RLS client — and hands
// their results to the pure presentation read-model (src/lib/parent/view-model.ts).
// Nothing here computes or stores learning state.

// The child a parent page shows: the `child` query parameter when it names one of the
// parent's own children (listChildren is RLS-scoped), else the first child. An id from the
// browser is never used to read anything until it matched this list.
export function selectChild(children: ChildWithLevel[], param: unknown): ChildWithLevel | null {
  const id = typeof param === "string" ? param : undefined;
  return children.find((c) => c.id === id) ?? children[0] ?? null;
}

export const loadFamily = cache(async (param: unknown) => {
  const children = await listChildren();
  return { children, child: selectChild(children, param) };
});

export const loadMinAttempts = cache(async () => {
  const rules = await loadLearningRules(await createClient());
  return rules.review.minAttempts;
});

export type ParentDashboardData = {
  view: ParentDashboardViewModel;
  progress: Awaited<ReturnType<typeof loadChildProgress>>;
};

export function toParentSkills(skills: Awaited<ReturnType<typeof loadSkillProgress>>): ParentSkill[] {
  return skills.map((s) => ({
    skillId: s.skillId,
    title: s.childTitle || s.title,
    domain: s.domain,
    status: s.status,
    masteryScore: s.masteryScore,
    attempts: s.attempts,
    lastPracticedAt: s.lastPracticedAt,
  }));
}

// Everything the dashboard shows for one (already ownership-checked) child: five loaders
// in parallel, each bounded (history page of 10, open sittings ≤ 10, runs of 30 days).
export async function loadParentDashboard(child: ChildWithLevel, timeZone: string, now = new Date()) {
  const [adaptive, progress, history, open, minAttempts] = await Promise.all([
    loadAdaptive(child.id),
    loadChildProgress(child.id, timeZone, now, child.current_level_id),
    loadSittingHistory(child.id, 0, 10),
    loadOpenSittings(child.id, now),
    loadMinAttempts(),
  ]);
  const view = buildParentDashboard({
    childId: child.id,
    childName: child.name,
    readiness: adaptive.readiness,
    recommendations: adaptive.recommendations,
    plan: adaptive.plan,
    skills: toParentSkills(progress.skills),
    runs: progress.recentRuns,
    history,
    waitingChecks: open.length,
    lessonsCompleted: progress.lessonsCompleted,
    activeDaysThisWeek: progress.activeDaysThisWeek,
    minAttempts,
  });
  return { view, progress, adaptive };
}

export const TREND_LOOKBACK_DAYS = 56;
const TREND_ROW_LIMIT = 1000;

// First-try LESSON answers of the last 8 weeks (checks excluded: they give no feedback and
// are a different situation), grouped by domain through the skills already loaded, for the
// presentation trend. One bounded query; nothing is written.
export async function loadDomainTrends(
  childId: string,
  skills: ParentSkill[],
  now = new Date(),
): Promise<Record<Domain, Trend>> {
  const supabase = await createClient();
  const since = new Date(now.getTime() - TREND_LOOKBACK_DAYS * 86400_000).toISOString();
  const { data, error } = await supabase
    .from("activity_attempts")
    .select("skill_id, is_correct, attempted_at")
    .eq("child_id", childId)
    .eq("attempt_number", 1)
    .is("assessment_attempt_id", null)
    .gte("attempted_at", since)
    .order("attempted_at", { ascending: false })
    .limit(TREND_ROW_LIMIT);
  if (error) throw error;
  const domainOf = new Map(skills.map((s) => [s.skillId, s.domain]));
  const points = new Map<Domain, { at: string; correct: boolean }[]>(DOMAINS.map((d) => [d, []]));
  for (const row of data ?? []) {
    const domain = row.skill_id ? domainOf.get(row.skill_id) : null;
    if (domain) points.get(domain)!.push({ at: row.attempted_at, correct: !!row.is_correct });
  }
  return Object.fromEntries(DOMAINS.map((d) => [d, answerTrend(points.get(d)!)])) as Record<Domain, Trend>;
}

// The header of an area page (phonics, words, spelling, reading, writing): the area's level
// and evidence, its state and trend, its skills in parent words, and the adaptive engine's
// first recommendation for the area with a tip for home.
export async function loadDomainOverview(child: ChildWithLevel, domain: Domain, now = new Date()) {
  const [adaptive, skillRows, minAttempts] = await Promise.all([
    loadAdaptive(child.id),
    loadSkillProgress(child.id),
    loadMinAttempts(),
  ]);
  const skills = toParentSkills(skillRows);
  const trends = await loadDomainTrends(child.id, skills, now);
  const inDomain = adaptive.recommendations.filter((r) => r.domain === domain);
  const next = practiceView(inDomain).top;
  return {
    domain,
    level: levelLines(adaptive.readiness).find((l) => l.domain === domain)!,
    snapshot: domainSnapshot({ domain, skills, recommendations: adaptive.recommendations, minAttempts }),
    trend: trends[domain],
    skills: skills
      .filter((s) => s.domain === domain)
      .sort((a, b) => (b.lastPracticedAt ?? "").localeCompare(a.lastPracticedAt ?? "")),
    next: next ? { ...next, guidance: homeGuidance(inDomain[0]) } : null,
  };
}
export type DomainOverview = Awaited<ReturnType<typeof loadDomainOverview>>;
