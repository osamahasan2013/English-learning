import "server-only";

import {
  DOMAIN_NAMES,
  parseBlueprint,
  type AssessmentType,
  type Domain,
} from "@/lib/learning/assessment-blueprint";
import { createClient } from "@/lib/supabase/server";

// Read-only assessment views for the child and parent screens (Phase 9). Every query runs on
// the parent's RLS client, so only the signed-in parent's children are ever visible.

export const ASSESSMENT_TYPE_NAMES: Record<AssessmentType, string> = {
  placement: "Placement",
  diagnostic: "Diagnostic",
  progress_check: "Progress check",
  skill_check: "Skill check",
  reassessment: "Re-check",
  end_of_unit: "End of unit",
  review_check: "Review check",
};

export type OpenSitting = {
  id: string;
  code: string;
  title: string;
  childTitle: string;
  emoji: string;
  type: AssessmentType;
  origin: string;
  startedAt: string;
  items: number;
  answered: number;
};

// Sittings still open (not expired) for this child: "a check is waiting" on the child home.
export async function loadOpenSittings(childId: string, now = new Date()): Promise<OpenSitting[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessment_attempts")
    .select("id, purpose, origin, started_at, expires_at, item_ids, assessments(code, title, config)")
    .eq("child_id", childId)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  const open = (data ?? []).filter(
    (s) => (!s.expires_at || Date.parse(s.expires_at) > now.getTime()) && s.item_ids.length > 0,
  );
  if (open.length === 0) return [];
  const { data: answers, error: answersError } = await supabase
    .from("activity_attempts")
    .select("assessment_attempt_id")
    .eq("child_id", childId)
    .eq("attempt_number", 1)
    .in(
      "assessment_attempt_id",
      open.map((s) => s.id),
    );
  if (answersError) throw answersError;
  return open.map((s) => {
    const a = Array.isArray(s.assessments) ? s.assessments[0] : s.assessments;
    const blueprint = parseBlueprint(a?.config);
    return {
      id: s.id,
      code: a?.code ?? "",
      title: a?.title ?? "Check",
      childTitle: blueprint?.childTitle ?? a?.title ?? "Check",
      emoji: blueprint?.emoji ?? "🎯",
      type: s.purpose as AssessmentType,
      origin: s.origin,
      startedAt: s.started_at,
      items: s.item_ids.length,
      answered: (answers ?? []).filter((x) => x.assessment_attempt_id === s.id).length,
    };
  });
}

export type SittingHistoryEntry = {
  id: string;
  title: string;
  type: AssessmentType;
  status: "in_progress" | "completed" | "abandoned" | "expired";
  origin: string;
  startedAt: string;
  completedAt: string | null;
  result: {
    overall: number;
    partial: boolean;
    sections: {
      label: string;
      domain: Domain | null;
      percent: number;
      passed: boolean;
      items: number;
      correct: number;
    }[];
    evidence: {
      skillId: string;
      title: string;
      correct: number;
      total: number;
      strength: string;
      gap: boolean;
    }[];
    comparison: { skillId: string; title: string; before: number | null; after: number; change: string }[];
  } | null;
};

// Assessment history, newest first (paginated). Completed sittings carry their result.
export async function loadSittingHistory(
  childId: string,
  page = 0,
  pageSize = 10,
): Promise<SittingHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessment_attempts")
    .select(
      "id, purpose, status, origin, started_at, completed_at, assessments(title), assessment_results(overall_score, dimension_scores, evidence_summary, comparison, partial)",
    )
    .eq("child_id", childId)
    .order("started_at", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  const skillIds = new Set<string>();
  for (const row of data ?? []) {
    const r = Array.isArray(row.assessment_results) ? row.assessment_results[0] : row.assessment_results;
    for (const e of (r?.evidence_summary ?? []) as { skillId: string }[]) skillIds.add(e.skillId);
  }
  const { data: skills } = skillIds.size
    ? await supabase
        .from("skills")
        .select("id, title, child_title")
        .in("id", [...skillIds])
    : { data: [] };
  const title = (id: string) => {
    const s = (skills ?? []).find((x) => x.id === id);
    return s?.title || s?.child_title || "";
  };
  return (data ?? []).map((row) => {
    const a = Array.isArray(row.assessments) ? row.assessments[0] : row.assessments;
    const r = Array.isArray(row.assessment_results) ? row.assessment_results[0] : row.assessment_results;
    type Section = {
      label?: string;
      domain?: Domain;
      percent?: number;
      passed?: boolean;
      secure?: boolean;
      items?: number;
      total?: number;
      correct?: number;
      served?: boolean;
      order?: number;
      stage?: number;
    };
    return {
      id: row.id,
      title: a?.title ?? "Check",
      type: row.purpose as AssessmentType,
      status: row.status as SittingHistoryEntry["status"],
      origin: row.origin,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      result: r
        ? {
            overall: Number(r.overall_score),
            partial: r.partial,
            sections: Object.entries((r.dimension_scores ?? {}) as Record<string, Section>)
              .filter(([, s]) => s.served !== false)
              .sort(([, x], [, y]) => (x.order ?? x.stage ?? 0) - (y.order ?? y.stage ?? 0))
              .map(([key, s]) => ({
                label: s.label ?? key,
                domain: s.domain ?? null,
                percent: Number(s.percent ?? 0),
                passed: s.passed ?? !!s.secure,
                items: s.items ?? s.total ?? 0,
                correct: s.correct ?? 0,
              })),
            evidence: (
              (r.evidence_summary ?? []) as {
                skillId: string;
                correct: number;
                total: number;
                strength: string;
                gap?: boolean;
              }[]
            ).map((e) => ({
              skillId: e.skillId,
              title: title(e.skillId),
              correct: e.correct,
              total: e.total,
              strength: e.strength,
              gap: !!e.gap,
            })),
            comparison: (
              (
                (r.comparison ?? null) as {
                  skills?: { skillId: string; before: number | null; after: number; change: string }[];
                } | null
              )?.skills ?? []
            ).map((c) => ({ ...c, title: title(c.skillId) })),
          }
        : null,
    };
  });
}

export type AvailableCheck = {
  code: string;
  title: string;
  type: AssessmentType;
  domains: { code: Domain; name: string }[];
  needsDomain: boolean;
  description: string;
};

// Checks a parent can start for a child (published assessments that need no specific scope,
// or only a domain).
export async function listAvailableChecks(): Promise<AvailableCheck[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessments")
    .select("code, title, description, assessment_type, domains, config")
    .eq("status", "published")
    .order("code");
  if (error) throw error;
  return (data ?? []).flatMap((a) => {
    const blueprint = parseBlueprint(a.config);
    // Re-checks and unit checks need a skill or unit: they are offered where those are known.
    if (blueprint && (blueprint.pool === "skills" || blueprint.pool === "unit")) return [];
    return [
      {
        code: a.code,
        title: a.title,
        type: a.assessment_type as AssessmentType,
        domains: (a.domains as Domain[]).map((d) => ({ code: d, name: DOMAIN_NAMES[d] })),
        needsDomain: blueprint?.pool === "level",
        description: a.description,
      },
    ];
  });
}
