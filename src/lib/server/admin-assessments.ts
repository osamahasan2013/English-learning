import "server-only";

import { parseBlueprint, sectionStage, type Blueprint } from "@/lib/learning/assessment-blueprint";
import type { LearningRules } from "@/lib/learning/rules";
import { loadLearningRules } from "@/lib/server/learning-rules";
import { createClient } from "@/lib/supabase/server";

// Admin overview of assessment content (Phase 9): blueprints, the authored item pool per
// section (size, skills, difficulty), how often items have been served (counts only, from
// the admin-only assessment_item_exposure function — never child ids), import flags and the
// effective engine rules. Admins see no family data (RLS).

export type AdminSection = {
  code: string;
  label: string;
  domain: string;
  level: string | null;
  draw: number;
  maxPerSkill: number;
  pool: number;
  skills: number;
  difficulty: { min: number; max: number } | null;
  shortfall: boolean;
};

export type AdminAssessment = {
  id: string;
  code: string;
  title: string;
  type: string;
  status: string;
  version: number;
  domains: string[];
  blueprint: Blueprint | null;
  sections: AdminSection[];
  itemsTotal: number;
  exposure: { served: number; answers: number; maxAnswers: number };
  flags: { rule: string; severity: string; message: string }[];
};

export async function loadAdminAssessments(): Promise<{
  assessments: AdminAssessment[];
  rules: LearningRules;
}> {
  const supabase = await createClient();
  const [assessments, items, flags, rules] = await Promise.all([
    supabase
      .from("assessments")
      .select("id, code, title, assessment_type, status, version, domains, config")
      .order("code"),
    supabase
      .from("assessment_items")
      .select("assessment_id, stage, difficulty, questions(skill_id)")
      .limit(5000),
    supabase.from("content_flags").select("entity_key, rule, severity, message").eq("entity", "assessment"),
    loadLearningRules(supabase),
  ]);
  for (const r of [assessments, items, flags]) if (r.error) throw r.error;

  const out: AdminAssessment[] = [];
  for (const a of assessments.data ?? []) {
    const blueprint = parseBlueprint(a.config);
    const own = (items.data ?? []).filter((i) => i.assessment_id === a.id);
    const { data: exposure, error: exposureError } = await supabase.rpc("assessment_item_exposure", {
      p_assessment_id: a.id,
    });
    if (exposureError) throw exposureError;
    const sections: AdminSection[] = (blueprint?.sections ?? []).map((s) => {
      const stage = sectionStage(blueprint!, s);
      const pool = blueprint!.pool === "authored" ? own.filter((i) => i.stage === stage) : [];
      const difficulties = pool.map((i) => i.difficulty);
      const skills = new Set(
        pool
          .map((i) => (Array.isArray(i.questions) ? i.questions[0] : i.questions)?.skill_id)
          .filter(Boolean),
      );
      return {
        code: s.code,
        label: s.label,
        domain: s.domain,
        level: s.level ?? null,
        draw: s.draw,
        maxPerSkill: s.maxPerSkill,
        pool: pool.length,
        skills: skills.size,
        difficulty: difficulties.length
          ? { min: Math.min(...difficulties), max: Math.max(...difficulties) }
          : null,
        shortfall: blueprint!.pool === "authored" && pool.length < s.draw,
      };
    });
    const counts = (exposure ?? []).map((e) => Number(e.answers));
    out.push({
      id: a.id,
      code: a.code,
      title: a.title,
      type: a.assessment_type,
      status: a.status,
      version: a.version,
      domains: a.domains,
      blueprint,
      sections,
      itemsTotal: own.length,
      exposure: {
        served: counts.length,
        answers: counts.reduce((x, y) => x + y, 0),
        maxAnswers: counts.length ? Math.max(...counts) : 0,
      },
      flags: (flags.data ?? []).filter((f) => f.entity_key === a.code),
    });
  }
  return { assessments: out, rules };
}
