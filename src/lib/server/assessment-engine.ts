import "server-only";

import {
  legacyBlueprint,
  parseBlueprint,
  sectionStage,
  type Blueprint,
  type BlueprintSection,
  type Domain,
  DOMAINS,
  SUBJECT_DOMAIN,
  type AssessmentType,
} from "@/lib/learning/assessment-blueprint";
import { selectItems, type SelectionCandidate } from "@/lib/learning/item-selection";
import { itemDifficulty } from "@/lib/learning/item-difficulty";
import type { LevelRef } from "@/lib/learning/readiness";
import type { LearningRules } from "@/lib/learning/rules";
import { questionTypeSchemas, isSupportedQuestionType } from "@/lib/content/question-schemas";
import { logger } from "@/lib/logging";
import { loadLearningRules } from "@/lib/server/learning-rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// The assessment engine's server side (Phase 9, ADR-047): sittings are started, resumed,
// abandoned and expired HERE, never by a device. Starting a sitting selects its questions
// from published content the server loads itself (item-selection.ts) and stores them on the
// sitting (assessment_attempts.item_ids); the progress writer then accepts answers only to
// those questions and scores the sitting from its stored first tries. The service-role
// client is used only after the parent's own RLS client has found the child.

type Db = ReturnType<typeof createAdminClient>;

// Open-ended writing is never assessed automatically (it can only be "needs review").
const NOT_ASSESSABLE = new Set([
  "INTRO",
  "READ_PASSAGE",
  "SENTENCE_WRITING",
  "GUIDED_WRITING",
  "STORY_ORDER_WRITING",
]);
const MAX_DYNAMIC_SKILLS = 8;
const uuidPattern = /^[0-9a-f-]{36}$/i;

export type SittingScope = { skillIds?: string[]; unitId?: string; domain?: Domain };

export type StoredSection = {
  code: string;
  label: string;
  domain: Domain;
  levelId: string | null;
  rank: number;
  passPercent: number;
};

// What a sitting stores in assessment_attempts.scope.
export type SittingPlan = {
  key: string;
  skillIds?: string[];
  unitId?: string;
  domain?: Domain;
  startRank: number;
  sections: StoredSection[];
  items: { q: string; s: string }[];
  shortfalls: { sectionCode: string; wanted: number; got: number }[];
};

export type AssessmentDefinition = {
  id: string;
  code: string;
  title: string;
  type: AssessmentType;
  version: number;
  blueprint: Blueprint;
  legacy: boolean;
  items: {
    questionId: string;
    stage: number;
    label: string;
    domain: Domain | null;
    levelId: string | null;
    difficulty: number;
  }[];
};

export async function loadLevels(db: Db): Promise<LevelRef[]> {
  const { data, error } = await db
    .from("levels")
    .select("id, code, sort_order")
    .eq("status", "published")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((l, i) => ({ id: l.id, code: l.code, rank: i + 1 }));
}

export async function loadDefinition(
  db: Db,
  by: { code: string } | { id: string },
  options: { publishedOnly?: boolean } = { publishedOnly: true },
): Promise<AssessmentDefinition | null> {
  let query = db.from("assessments").select("id, code, title, assessment_type, config, version, status");
  query = "code" in by ? query.eq("code", by.code) : query.eq("id", by.id);
  const { data: a, error } = await query.maybeSingle();
  if (error) throw error;
  if (!a || (options.publishedOnly && a.status !== "published")) return null;
  const { data: rows, error: itemsError } = await db
    .from("assessment_items")
    .select("question_id, stage, stage_label, sort_order, domain, level_id, difficulty")
    .eq("assessment_id", a.id)
    .order("stage")
    .order("sort_order");
  if (itemsError) throw itemsError;
  const items = (rows ?? []).map((r) => ({
    questionId: r.question_id,
    stage: r.stage,
    label: r.stage_label,
    domain: (DOMAINS as readonly string[]).includes(r.domain ?? "") ? (r.domain as Domain) : null,
    levelId: r.level_id,
    difficulty: r.difficulty,
  }));
  let blueprint = parseBlueprint(a.config);
  let legacy = false;
  if (!blueprint) {
    // Stored before Phase 9: every item, grouped by stage, as those sittings always ran.
    const levels = await loadLevels(db);
    const stages = [...new Set(items.map((i) => i.stage))].map((stage) => {
      const of = items.filter((i) => i.stage === stage);
      return {
        stage,
        label: of[0].label,
        count: of.length,
        domain: of[0].domain,
        level: levels.find((l) => l.id === of[0].levelId)?.code ?? null,
      };
    });
    if (stages.length === 0) return null;
    blueprint = legacyBlueprint(a.title, stages);
    legacy = true;
  }
  return {
    id: a.id,
    code: a.code,
    title: a.title,
    type: a.assessment_type as AssessmentType,
    version: a.version,
    blueprint,
    legacy,
    items,
  };
}

// Device-created sittings (older app versions) are only accepted where nothing is selected:
// every authored item, in order. Anything else must be started by the server.
export function acceptsDeviceSittings(definition: AssessmentDefinition) {
  return (
    definition.legacy ||
    (definition.blueprint.pool === "authored" &&
      definition.blueprint.stopping.rule === "none" &&
      definition.blueprint.sections.every(
        (s) =>
          s.draw >= definition.items.filter((i) => i.stage === sectionStage(definition.blueprint, s)).length,
      ))
  );
}

type SkillRow = {
  id: string;
  code: string;
  title: string;
  childTitle: string;
  domain: Domain | null;
  levelId: string;
};

async function loadSkills(
  db: Db,
  filter: { ids?: string[]; unitId?: string; levelId?: string; domain?: Domain },
) {
  let query = db
    .from("skills")
    .select(
      "id, code, title, child_title, is_active, status, unit_id, units!inner(level_id, status, subjects!inner(code))",
    )
    .eq("status", "published")
    .eq("is_active", true);
  if (filter.ids) query = query.in("id", filter.ids);
  if (filter.unitId) query = query.eq("unit_id", filter.unitId);
  if (filter.levelId) query = query.eq("units.level_id", filter.levelId);
  const { data, error } = await query;
  if (error) throw error;
  const out: SkillRow[] = [];
  for (const s of data ?? []) {
    const unit = Array.isArray(s.units) ? s.units[0] : s.units;
    if (!unit || unit.status !== "published") continue;
    const subject = Array.isArray(unit.subjects) ? unit.subjects[0] : unit.subjects;
    const domain = SUBJECT_DOMAIN[subject?.code ?? ""] ?? null;
    if (filter.domain && domain !== filter.domain) continue;
    out.push({
      id: s.id,
      code: s.code,
      title: s.title,
      childTitle: s.child_title,
      domain,
      levelId: unit.level_id,
    });
  }
  return out;
}

// Published, scored, auto-assessable questions of these skills from published lessons.
async function lessonQuestions(db: Db, skillIds: string[]) {
  if (skillIds.length === 0) return [];
  const { data, error } = await db
    .from("questions")
    .select(
      "id, skill_id, question_type, difficulty, word_id, phonics_pattern_id, story_id, activities(status, lessons(status))",
    )
    .in("skill_id", skillIds)
    .eq("status", "published");
  if (error) throw error;
  return (data ?? []).filter((q) => {
    const activity = Array.isArray(q.activities) ? q.activities[0] : q.activities;
    const lesson = activity
      ? Array.isArray(activity.lessons)
        ? activity.lessons[0]
        : activity.lessons
      : null;
    return (
      activity?.status === "published" &&
      lesson?.status === "published" &&
      isSupportedQuestionType(q.question_type) &&
      questionTypeSchemas[q.question_type].answer !== null &&
      !NOT_ASSESSABLE.has(q.question_type)
    );
  });
}

async function exposures(db: Db, childId: string, questionIds: string[]) {
  const counts = new Map<string, number>();
  for (let i = 0; i < questionIds.length; i += 200) {
    const { data, error } = await db
      .from("activity_attempts")
      .select("question_id")
      .eq("child_id", childId)
      .in("question_id", questionIds.slice(i, i + 200));
    if (error) throw error;
    for (const r of data ?? []) counts.set(r.question_id, (counts.get(r.question_id) ?? 0) + 1);
  }
  return counts;
}

export type StartResult = { ok: true; attemptId: string; resumed: boolean } | { ok: false; reason: string };

// Starts (or resumes) a sitting for a child the caller has verified with the parent's RLS
// client. `scope` names what a dynamic assessment covers (skills to re-check, a unit).
export async function startSitting(args: {
  childId: string;
  code: string;
  scope?: SittingScope;
  origin: "child" | "parent" | "recommendation";
  previousAttemptId?: string | null;
  now?: Date;
}): Promise<StartResult> {
  const now = args.now ?? new Date();
  if (!uuidPattern.test(args.childId) || !/^[a-z0-9-]{2,80}$/.test(args.code))
    return { ok: false, reason: "not_found" };
  // Ownership through the parent's own client: another family's child is simply not found.
  const rls = await createClient();
  const { data: owned } = await rls.from("children").select("id").eq("id", args.childId).maybeSingle();
  if (!owned) return { ok: false, reason: "not_found" };

  const db = createAdminClient();
  const [definition, rules, levels, { data: child, error: childError }] = await Promise.all([
    loadDefinition(db, { code: args.code }),
    loadLearningRules(db),
    loadLevels(db),
    db
      .from("children")
      .select("grade_level_id, current_level_id, learning_epoch")
      .eq("id", args.childId)
      .maybeSingle(),
  ]);
  if (childError) throw childError;
  if (!definition || !child) return { ok: false, reason: "not_found" };
  await expireSittings(db, args.childId, now, rules);

  const scope = await resolveScope(db, args.childId, definition, args.scope ?? {});
  if (!scope.ok) return scope;
  const key = scopeKey(scope.value);

  // Resume an open sitting of the same assessment and scope instead of starting another.
  const { data: open, error: openError } = await db
    .from("assessment_attempts")
    .select("id, scope")
    .eq("child_id", args.childId)
    .eq("assessment_id", definition.id)
    .eq("status", "in_progress")
    .eq("learning_epoch", child.learning_epoch)
    .order("started_at", { ascending: false });
  if (openError) throw openError;
  const same = (open ?? []).find((s) => ((s.scope ?? {}) as { key?: string }).key === key);
  if (same) return { ok: true, attemptId: same.id, resumed: true };

  const attemptId = crypto.randomUUID();
  const plan = await planSitting(db, {
    childId: args.childId,
    definition,
    levels,
    gradeLevelId: child.grade_level_id,
    currentLevelId: child.current_level_id,
    scope: scope.value,
    seed: attemptId,
    rules,
  });
  if (plan.items.length === 0) {
    logger.warn("assessment.no_items", { code: definition.code, childId: args.childId });
    return { ok: false, reason: "no_items" };
  }
  if (plan.shortfalls.length > 0)
    logger.warn("assessment.shortfall", { code: definition.code, count: plan.shortfalls.length });

  const expiresHours = definition.blueprint.expiresAfterHours ?? rules.assessment.sittingExpiryHours;
  const { error } = await db.from("assessment_attempts").insert({
    id: attemptId,
    child_id: args.childId,
    assessment_id: definition.id,
    assessment_version: definition.version,
    purpose: definition.type,
    started_at: now.toISOString(),
    status: "in_progress",
    item_ids: plan.items.map((i) => i.q),
    scope: { ...plan, key },
    origin: args.origin,
    learning_epoch: child.learning_epoch,
    expires_at: new Date(now.getTime() + expiresHours * 3600_000).toISOString(),
    last_activity_at: now.toISOString(),
    previous_attempt_id: args.previousAttemptId ?? null,
  });
  if (error) throw error;
  logger.info("assessment.started", {
    code: definition.code,
    attemptId,
    childId: args.childId,
    items: plan.items.length,
  });
  return { ok: true, attemptId, resumed: false };
}

const scopeKey = (s: SittingScope) =>
  s.skillIds?.length
    ? `skills:${[...s.skillIds].sort().join(",")}`
    : s.unitId
      ? `unit:${s.unitId}`
      : s.domain
        ? `domain:${s.domain}`
        : "";

// Validates the scope a request names against published content (a client cannot ask for an
// arbitrary question; at most it can name a skill or unit that exists).
async function resolveScope(
  db: Db,
  childId: string,
  definition: AssessmentDefinition,
  scope: SittingScope,
): Promise<{ ok: true; value: SittingScope } | { ok: false; reason: string }> {
  const pool = definition.blueprint.pool;
  if (pool === "skills") {
    const ids = (scope.skillIds ?? []).filter((id) => uuidPattern.test(id)).slice(0, MAX_DYNAMIC_SKILLS);
    const skills = await loadSkills(db, { ids });
    if (skills.length === 0) return { ok: false, reason: "no_scope" };
    return { ok: true, value: { skillIds: skills.map((s) => s.id).sort() } };
  }
  if (pool === "unit") {
    if (!scope.unitId || !uuidPattern.test(scope.unitId)) return { ok: false, reason: "no_scope" };
    const { data } = await db
      .from("units")
      .select("id")
      .eq("id", scope.unitId)
      .eq("status", "published")
      .maybeSingle();
    return data ? { ok: true, value: { unitId: data.id } } : { ok: false, reason: "no_scope" };
  }
  if (pool === "level" && scope.domain && (DOMAINS as readonly string[]).includes(scope.domain))
    return { ok: true, value: { domain: scope.domain } };
  if (pool === "review") {
    const { data, error } = await db
      .from("review_items")
      .select("skill_id, priority")
      .eq("child_id", childId)
      .eq("status", "open")
      .not("skill_id", "is", null)
      .lte("due_at", new Date().toISOString())
      .order("priority", { ascending: false })
      .limit(MAX_DYNAMIC_SKILLS);
    if (error) throw error;
    const ids = [...new Set((data ?? []).map((r) => r.skill_id!))];
    if (ids.length === 0) return { ok: false, reason: "nothing_due" };
    return { ok: true, value: { skillIds: ids.sort() } };
  }
  return { ok: true, value: {} };
}

async function planSitting(
  db: Db,
  args: {
    childId: string;
    definition: AssessmentDefinition;
    levels: LevelRef[];
    gradeLevelId: string;
    currentLevelId: string;
    scope: SittingScope;
    seed: string;
    rules: LearningRules;
  },
): Promise<Omit<SittingPlan, "key">> {
  const { blueprint } = args.definition;
  const rankOf = (levelId: string | null) => args.levels.find((l) => l.id === levelId)?.rank ?? 1;
  const levelByCode = (code?: string) => args.levels.find((l) => l.code === code) ?? null;
  const maxRank = args.levels.length;
  const gradeRank = rankOf(args.gradeLevelId);
  const startRank = Math.max(1, Math.min(maxRank, gradeRank + blueprint.stopping.startOffset));
  const passPercent = blueprint.passPercent ?? args.rules.assessment.sectionPassPercent;

  const sections: StoredSection[] = [];
  const candidates: SelectionCandidate[] = [];
  const selectionSections: {
    code: string;
    draw: number;
    maxPerSkill: number;
    difficulty?: [number, number];
  }[] = [];

  if (blueprint.pool === "authored") {
    const questionIds = args.definition.items.map((i) => i.questionId);
    const { data: questions, error } = await db
      .from("questions")
      .select("id, skill_id, status, word_id, phonics_pattern_id, story_id")
      .in("id", questionIds);
    if (error) throw error;
    const byId = new Map((questions ?? []).filter((q) => q.status === "published").map((q) => [q.id, q]));
    for (const section of blueprint.sections) {
      const level = levelByCode(section.level);
      sections.push(storedSection(section, level?.id ?? null, level?.rank ?? 1, passPercent));
      selectionSections.push(selectionOf(section));
      for (const item of args.definition.items.filter((i) => i.stage === sectionStage(blueprint, section))) {
        const q = byId.get(item.questionId);
        if (!q) continue;
        candidates.push({
          questionId: q.id,
          sectionCode: section.code,
          skillId: q.skill_id,
          varietyKey: q.word_id ?? q.phonics_pattern_id ?? q.story_id ?? null,
          difficulty: item.difficulty,
          exposures: 0,
        });
      }
    }
  } else {
    // Dynamic pools: lesson questions of the skills in scope, one section per blueprint
    // section (a section's domain narrows the skills; its level defaults to the domain's
    // instructional level).
    const readiness = await loadReadinessLevels(db, args.childId);
    // A domain-scoped sitting (a diagnostic of one area) uses that domain's sections only.
    const scoped = args.scope.domain
      ? blueprint.sections.filter((s) => s.domain === args.scope.domain)
      : blueprint.sections;
    for (const section of scoped) {
      const level =
        levelByCode(section.level) ??
        args.levels.find((l) => l.id === (readiness.get(section.domain) ?? args.currentLevelId)) ??
        null;
      let skills: SkillRow[];
      if (args.scope.skillIds) skills = await loadSkills(db, { ids: args.scope.skillIds });
      else if (args.scope.unitId) skills = await loadSkills(db, { unitId: args.scope.unitId });
      else skills = await loadSkills(db, { levelId: level?.id, domain: section.domain });
      if (section.skills?.length) skills = skills.filter((s) => section.skills!.includes(s.code));
      if (!args.scope.skillIds && !args.scope.unitId)
        skills = skills.filter((s) => s.domain === section.domain);
      const domain = skills[0]?.domain ?? section.domain;
      const skillLevel = args.levels.find((l) => l.id === skills[0]?.levelId) ?? level;
      sections.push(
        storedSection(
          { ...section, domain },
          skillLevel?.id ?? null,
          skillLevel?.rank ?? rankOf(args.currentLevelId),
          passPercent,
        ),
      );
      selectionSections.push(selectionOf(section));
      const rankBySkill = new Map(skills.map((s) => [s.id, rankOf(s.levelId)]));
      for (const q of await lessonQuestions(db, skills.map((s) => s.id).slice(0, 40)))
        candidates.push({
          questionId: q.id,
          sectionCode: section.code,
          skillId: q.skill_id,
          varietyKey: q.word_id ?? q.phonics_pattern_id ?? q.story_id ?? null,
          difficulty: itemDifficulty({
            levelRank: rankBySkill.get(q.skill_id) ?? 1,
            questionType: q.question_type,
            authored: q.difficulty,
          }),
          exposures: 0,
        });
    }
  }

  const seen = await exposures(db, args.childId, [...new Set(candidates.map((c) => c.questionId))]);
  for (const c of candidates) c.exposures = seen.get(c.questionId) ?? 0;
  const selection = selectItems({
    sections: selectionSections,
    candidates,
    seed: args.seed,
    maxItems: blueprint.maxItems,
  });
  return {
    skillIds: args.scope.skillIds,
    unitId: args.scope.unitId,
    domain: args.scope.domain,
    startRank,
    sections,
    items: selection.items.map((i) => ({ q: i.questionId, s: i.sectionCode })),
    shortfalls: selection.shortfalls,
  };
}

function storedSection(
  section: BlueprintSection,
  levelId: string | null,
  rank: number,
  passPercent: number,
): StoredSection {
  return { code: section.code, label: section.label, domain: section.domain, levelId, rank, passPercent };
}
const selectionOf = (s: BlueprintSection) => ({
  code: s.code,
  draw: s.draw,
  maxPerSkill: s.maxPerSkill,
  difficulty: s.difficulty,
});

async function loadReadinessLevels(db: Db, childId: string) {
  const { data, error } = await db
    .from("instructional_readiness")
    .select("domain, current_level_id, confidence")
    .eq("child_id", childId);
  if (error) throw error;
  return new Map(
    (data ?? [])
      .filter((r) => r.confidence !== "INSUFFICIENT")
      .map((r) => [r.domain as Domain, r.current_level_id]),
  );
}

// Unfinished sittings past their expiry become "expired" (their answers stay as practice).
export async function expireSittings(db: Db, childId: string, now: Date, _rules?: LearningRules) {
  const { error } = await db
    .from("assessment_attempts")
    .update({ status: "expired" })
    .eq("child_id", childId)
    .eq("status", "in_progress")
    .lt("expires_at", now.toISOString());
  if (error) throw error;
}

// A parent cancels a sitting (from the assessments page). Child ownership checked with the
// parent's client first; only an open sitting of that child can be abandoned.
export async function abandonSitting(childId: string, attemptId: string): Promise<boolean> {
  if (!uuidPattern.test(childId) || !uuidPattern.test(attemptId)) return false;
  const rls = await createClient();
  const { data: owned } = await rls.from("children").select("id").eq("id", childId).maybeSingle();
  if (!owned) return false;
  const db = createAdminClient();
  const { data, error } = await db
    .from("assessment_attempts")
    .update({ status: "abandoned" })
    .eq("id", attemptId)
    .eq("child_id", childId)
    .eq("status", "in_progress")
    .select("id");
  if (error) throw error;
  if (data?.length) logger.info("assessment.abandoned", { attemptId, childId });
  return (data?.length ?? 0) > 0;
}
