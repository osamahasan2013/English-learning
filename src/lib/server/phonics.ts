import "server-only";

import type { MasteryStatus } from "@/lib/learning/mastery";
import {
  practiceSuggestions,
  summarizeStages,
  type PhonicsSkillFact,
  type PhonicsStageFact,
} from "@/lib/learning/phonics-progress";
import { createClient } from "@/lib/supabase/server";

// Phonics data for the child's Phonics screen, the parent dashboard and the pattern
// search. Everything is read with the signed-in user's RLS client: published content
// only (admins also see drafts), and progress only for the parent's own children.

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export const PHONICS_CHECK_CODE = "phonics-check";

export async function loadChildPhonics(childId: string) {
  const supabase = await createClient();
  const [stagesRes, skillsRes, masteryRes, checkRes] = await Promise.all([
    supabase.from("phonics_stages").select("code, name, child_name, emoji, sort_order").order("sort_order"),
    supabase
      .from("skills")
      .select(
        "id, code, title, child_title, sort_order, phonics_stage_code, phonics_patterns(pattern, uppercase, pattern_type), units(sort_order, levels(sort_order)), lessons(id, emoji, sort_order, status)",
      )
      .eq("status", "published")
      .eq("is_active", true)
      .not("phonics_stage_code", "is", null),
    supabase
      .from("skill_mastery")
      .select("skill_id, status, mastery_score, review_priority")
      .eq("child_id", childId),
    supabase
      .from("assessments")
      .select("id, title, config")
      .eq("code", PHONICS_CHECK_CODE)
      .eq("status", "published")
      .maybeSingle(),
  ]);
  for (const r of [stagesRes, skillsRes, masteryRes]) if (r.error) throw r.error;

  const mastery = new Map((masteryRes.data ?? []).map((m) => [m.skill_id, m]));
  const skills: PhonicsSkillFact[] = (skillsRes.data ?? []).map((s) => {
    const unit = one(s.units);
    const level = one(unit?.levels);
    const pattern = one(s.phonics_patterns);
    const lesson = [...(s.lessons ?? [])]
      .filter((l) => l.status === "published")
      .sort((a, b) => a.sort_order - b.sort_order)[0];
    const m = mastery.get(s.id);
    return {
      skillId: s.id,
      code: s.code,
      title: s.child_title || s.title,
      stageCode: s.phonics_stage_code!,
      patternLabel: pattern
        ? pattern.pattern_type === "letter"
          ? `${pattern.uppercase ?? pattern.pattern.toUpperCase()}${pattern.pattern}`
          : pattern.pattern.replace("_", "–")
        : null,
      emoji: lesson?.emoji ?? "",
      lessonId: lesson?.id ?? null,
      status: (m?.status ?? "NOT_STARTED") as MasteryStatus,
      masteryScore: Number(m?.mastery_score ?? 0),
      reviewPriority: Number(m?.review_priority ?? 0),
      sortOrder: (level?.sort_order ?? 0) * 1_000_000 + (unit?.sort_order ?? 0) * 1_000 + s.sort_order,
    };
  });
  const stages: PhonicsStageFact[] = (stagesRes.data ?? []).map((s) => ({
    code: s.code,
    name: s.name,
    childName: s.child_name,
    emoji: s.emoji,
    sortOrder: s.sort_order,
  }));
  const check = checkRes.data;
  const checkConfig = (check?.config ?? {}) as { childTitle?: unknown; emoji?: unknown };
  return {
    stages: summarizeStages(stages, skills),
    practice: practiceSuggestions(skills),
    check: check
      ? {
          code: PHONICS_CHECK_CODE,
          title: typeof checkConfig.childTitle === "string" ? checkConfig.childTitle : check.title,
          emoji: typeof checkConfig.emoji === "string" ? checkConfig.emoji : "🎯",
        }
      : null,
  };
}
export type ChildPhonics = Awaited<ReturnType<typeof loadChildPhonics>>;

// The child's latest Phonics Check result, per area, for the parent.
export async function loadLatestPhonicsCheck(childId: string) {
  const supabase = await createClient();
  const { data: assessment } = await supabase
    .from("assessments")
    .select("id")
    .eq("code", PHONICS_CHECK_CODE)
    .maybeSingle();
  if (!assessment) return null;
  const { data, error } = await supabase
    .from("assessment_results")
    .select("overall_score, dimension_scores, created_at, assessment_attempts!inner(assessment_id)")
    .eq("child_id", childId)
    .eq("assessment_attempts.assessment_id", assessment.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const areas = Object.entries(
    (data.dimension_scores ?? {}) as Record<string, { stage?: number; percent?: number; secure?: boolean }>,
  )
    .map(([label, a]) => ({
      label,
      stage: a.stage ?? 0,
      percent: Number(a.percent ?? 0),
      secure: !!a.secure,
    }))
    .sort((a, b) => a.stage - b.stage);
  return { overall: Number(data.overall_score), takenAt: data.created_at, areas };
}

export const PATTERN_PAGE_SIZE = 20;

export type PatternSearch = { q?: string; type?: string; stage?: string; level?: string; page?: number };

// Pattern search with filters and pagination, straight from the database (never the
// whole bank to the browser). Example words are loaded for the current page only.
export async function searchPhonicsPatterns(search: PatternSearch) {
  const supabase = await createClient();
  const page = Math.max(1, Math.floor(search.page ?? 1));
  const from = (page - 1) * PATTERN_PAGE_SIZE;

  let query = supabase
    .from("phonics_patterns")
    .select(
      "id, code, pattern, pattern_type, stage_code, position, difficulty, explanation, child_explanation, status, levels(code, name), phonics_pattern_sounds(code, label, say_as, ipa, is_primary, sort_order)",
      { count: "exact" },
    )
    .order("sort_order")
    .order("code")
    .range(from, from + PATTERN_PAGE_SIZE - 1);
  const q = (search.q ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z_ -]/g, "");
  if (q) {
    const text = q.replace(/[\s-]+/g, "_");
    query = query.or(`pattern.ilike.${text}%,code.ilike.%${text.toUpperCase()}%`);
  }
  if (search.type) query = query.eq("pattern_type", search.type);
  if (search.stage) query = query.eq("stage_code", search.stage);
  if (search.level) {
    const { data: level } = await supabase.from("levels").select("id").eq("code", search.level).maybeSingle();
    query = query.eq("level_id", level?.id ?? "00000000-0000-0000-0000-000000000000");
  }
  const { data, error, count } = await query;
  if (error) throw error;

  const ids = (data ?? []).map((p) => p.id);
  const examples = new Map<string, { word: string; emoji: string }[]>();
  if (ids.length > 0) {
    const { data: links, error: linksError } = await supabase
      .from("word_phonics_patterns")
      .select("pattern_id, words!inner(word, emoji, status, difficulty)")
      .in("pattern_id", ids)
      .eq("words.status", "published")
      .limit(ids.length * 12);
    if (linksError) throw linksError;
    for (const l of links ?? []) {
      const w = one(l.words);
      if (!w) continue;
      const list = examples.get(l.pattern_id) ?? [];
      if (list.length < 6 && !list.some((x) => x.word === w.word))
        list.push({ word: w.word, emoji: w.emoji });
      examples.set(l.pattern_id, list);
    }
  }

  return {
    page,
    total: count ?? 0,
    pages: Math.max(1, Math.ceil((count ?? 0) / PATTERN_PAGE_SIZE)),
    patterns: (data ?? []).map((p) => ({
      id: p.id,
      code: p.code,
      pattern: p.pattern.replace("_", "–"),
      type: p.pattern_type,
      stage: p.stage_code,
      position: p.position,
      difficulty: p.difficulty,
      explanation: p.explanation,
      childExplanation: p.child_explanation,
      status: p.status,
      level: one(p.levels)?.name ?? "",
      sounds: [...(p.phonics_pattern_sounds ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((s) => ({ code: s.code, label: s.label, sayAs: s.say_as, ipa: s.ipa, primary: s.is_primary })),
      examples: examples.get(p.id) ?? [],
    })),
  };
}

// Filter choices for the search form, from the database.
export async function loadPatternFilters() {
  const supabase = await createClient();
  const [stages, levels, types] = await Promise.all([
    supabase.from("phonics_stages").select("code, name").order("sort_order"),
    supabase.from("levels").select("code, name").eq("status", "published").order("sort_order"),
    supabase.from("phonics_patterns").select("pattern_type"),
  ]);
  for (const r of [stages, levels, types]) if (r.error) throw r.error;
  return {
    stages: stages.data ?? [],
    levels: levels.data ?? [],
    types: [...new Set((types.data ?? []).map((t) => t.pattern_type))].sort(),
  };
}

// Content that the importer flagged for review (admins only; RLS returns nothing to others).
export async function loadContentFlags(limit = 50) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_flags")
    .select("entity, entity_key, rule, severity, message, created_at")
    .order("severity")
    .order("entity")
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
