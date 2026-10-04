import "server-only";

import type { MasteryStatus } from "@/lib/learning/mastery";
import type { WritingAnalysis } from "@/lib/learning/writing";
import { WRITING_QUESTION_TYPES } from "@/lib/learning/writing-evaluation";
import {
  summarizeWriting,
  writingSkillProgress,
  writtenText,
  type WritingAttemptFact,
  type WritingSkillFact,
} from "@/lib/learning/writing-report";
import { glyphFromRow, GLYPH_COLUMNS, type GlyphRow } from "@/lib/server/glyphs";
import { createClient } from "@/lib/supabase/server";

// Writing screens: the child's writing home and the parent's writing report. Everything is
// read with the parent's RLS client, so only the parent's own children are visible.

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Answers that are writing: the writing question types and typed words (SPELLING) of
// writing lessons. Typed words also count as spelling (spelling report); here they only
// add to the samples and mechanics when the server analysed them as writing.
const WRITING_TYPES = [...WRITING_QUESTION_TYPES];

async function writingLessons(supabase: Supabase) {
  const { data, error } = await supabase
    .from("lesson_catalog")
    .select(
      "lesson_id, lesson_child_title, lesson_title, lesson_emoji, lesson_order, skill_id, skill_child_title, skill_title, skill_order, unit_order, level_id, level_code, level_name, level_order",
    )
    .eq("subject_code", "WRITING")
    .eq("skill_active", true)
    .order("level_order")
    .order("unit_order")
    .order("skill_order")
    .order("lesson_order")
    .limit(400);
  if (error) throw error;
  return (data ?? []).filter((l) => l.lesson_id && l.skill_id && l.level_id);
}

export type WritingLessonCard = { id: string; title: string; emoji: string; stars: number };
export type WritingSkillGroup = {
  id: string;
  title: string;
  status: MasteryStatus;
  lessons: WritingLessonCard[];
};
export type WritingLevelGroup = { id: string; code: string; name: string; skills: WritingSkillGroup[] };

// The child's writing home: writing lessons by level and skill with stars and mastery, the
// letters that came back for review, and the child's latest pieces of writing.
export async function loadWritingHome(childId: string, levelId: string | null) {
  const supabase = await createClient();
  const [rows, letters, recent] = await Promise.all([
    writingLessons(supabase),
    supabase
      .from("review_items")
      .select("glyph_id, lesson_id, priority, handwriting_glyphs(code, character, name)")
      .eq("child_id", childId)
      .eq("status", "open")
      .like("item_key", "writing:%")
      .order("priority", { ascending: false })
      .limit(8),
    supabase
      .from("activity_attempts")
      .select("question_id, response, attempted_at, writing_analysis, questions(prompt)")
      .eq("child_id", childId)
      .in("question_type", ["SENTENCE_WRITING", "GUIDED_WRITING", "STORY_ORDER_WRITING"])
      .order("attempted_at", { ascending: false })
      .limit(12),
  ]);
  if (letters.error || recent.error) throw letters.error ?? recent.error;
  const lessonIds = rows.map((l) => l.lesson_id!);
  const skillIds = [...new Set(rows.map((l) => l.skill_id!))];
  const [progress, mastery] = await Promise.all([
    lessonIds.length
      ? supabase
          .from("lesson_progress")
          .select("lesson_id, best_stars")
          .eq("child_id", childId)
          .in("lesson_id", lessonIds)
      : Promise.resolve({ data: [], error: null }),
    skillIds.length
      ? supabase
          .from("skill_mastery")
          .select("skill_id, status")
          .eq("child_id", childId)
          .in("skill_id", skillIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (progress.error || mastery.error) throw progress.error ?? mastery.error;
  const stars = new Map((progress.data ?? []).map((p) => [p.lesson_id, p.best_stars]));
  const status = new Map((mastery.data ?? []).map((m) => [m.skill_id, m.status as MasteryStatus]));

  const levels = new Map<string, WritingLevelGroup>();
  for (const l of rows) {
    const level = levels.get(l.level_id!) ?? {
      id: l.level_id!,
      code: l.level_code ?? "",
      name: l.level_name ?? "",
      skills: [],
    };
    levels.set(l.level_id!, level);
    let skill = level.skills.find((s) => s.id === l.skill_id);
    if (!skill) {
      skill = {
        id: l.skill_id!,
        title: l.skill_child_title || l.skill_title || "",
        status: status.get(l.skill_id!) ?? "NOT_STARTED",
        lessons: [],
      };
      level.skills.push(skill);
    }
    skill.lessons.push({
      id: l.lesson_id!,
      title: l.lesson_child_title || l.lesson_title || "",
      emoji: l.lesson_emoji ?? "",
      stars: stars.get(l.lesson_id!) ?? 0,
    });
  }
  const all = [...levels.values()];
  const current = all.find((l) => l.id === levelId) ?? all[0] ?? null;
  return {
    current,
    others: all.filter((l) => l !== current),
    letters: (letters.data ?? []).map((r) => {
      const g = one(r.handwriting_glyphs);
      return {
        glyphId: r.glyph_id!,
        lessonId: r.lesson_id,
        character: g?.character ?? "",
        name: g?.name ?? "",
      };
    }),
    // The newest answer to each of the last few questions written.
    recent: (recent.data ?? [])
      .filter((r, i, all) => all.findIndex((x) => x.question_id === r.question_id) === i)
      .slice(0, 3)
      .map((r) => ({
        text: writtenText(r.response),
        prompt: one(r.questions)?.prompt ?? "",
        attemptedAt: r.attempted_at,
        words: (r.writing_analysis as WritingAnalysis | null)?.words ?? 0,
      }))
      .filter((r) => r.text.trim()),
  };
}

// The parent's writing report for one child: writing skills of the child's level with
// mastery, what the checks found (counts of checks met), handwriting, the letters to
// review and the child's latest pieces of writing.
export async function loadWritingReport(childId: string, levelId: string | null) {
  const supabase = await createClient();
  const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  const [attempts, skillTypes, taggedSkills, mastery, letters, levels] = await Promise.all([
    supabase
      .from("activity_attempts")
      .select(
        "question_id, question_type, attempt_number, is_correct, attempted_at, response, writing_analysis, questions(prompt)",
      )
      .eq("child_id", childId)
      .in("question_type", WRITING_TYPES)
      .gte("attempted_at", since)
      .order("attempted_at", { ascending: false })
      .limit(500),
    supabase
      .from("writing_skill_types")
      .select("code, name, child_name, strand, emoji, min_level_rank, max_level_rank, sort_order")
      .order("sort_order"),
    supabase.from("skills").select("id, writing_skill_code").not("writing_skill_code", "is", null),
    supabase
      .from("skill_mastery")
      .select("skill_id, status, mastery_score, attempts")
      .eq("child_id", childId),
    supabase
      .from("review_items")
      .select("glyph_id, handwriting_glyphs(character, name)")
      .eq("child_id", childId)
      .eq("status", "open")
      .like("item_key", "writing:%")
      .limit(20),
    supabase.from("levels").select("id, sort_order").order("sort_order"),
  ]);
  for (const r of [attempts, skillTypes, taggedSkills, mastery, letters, levels]) if (r.error) throw r.error;

  const facts: WritingAttemptFact[] = (attempts.data ?? []).map((a) => ({
    questionId: a.question_id,
    questionType: a.question_type,
    prompt: one(a.questions)?.prompt ?? "",
    attemptNumber: a.attempt_number,
    isCorrect: a.is_correct,
    attemptedAt: a.attempted_at,
    response: a.response,
    analysis: (a.writing_analysis as WritingAnalysis | null) ?? null,
  }));
  const rank = (levels.data ?? []).findIndex((l) => l.id === levelId) + 1 || 1;
  const writingSkillOf = new Map((taggedSkills.data ?? []).map((s) => [s.id, s.writing_skill_code!]));
  // A writing skill that no curriculum skill teaches yet (it is only checked inside other
  // work, e.g. spacing as a rubric dimension) has no mastery of its own: leave it out
  // rather than show it as "not started" for ever.
  const taught = new Set(writingSkillOf.values());
  const skills: WritingSkillFact[] = (skillTypes.data ?? [])
    .filter((s) => taught.has(s.code))
    .map((s) => ({
      code: s.code,
      name: s.name,
      childName: s.child_name,
      strand: s.strand,
      emoji: s.emoji,
      minRank: s.min_level_rank,
      maxRank: s.max_level_rank,
    }));
  return {
    levelRank: rank,
    summary: summarizeWriting(facts),
    skills: writingSkillProgress(
      skills,
      (mastery.data ?? [])
        .filter((m) => writingSkillOf.has(m.skill_id))
        .map((m) => ({
          writingSkill: writingSkillOf.get(m.skill_id)!,
          status: m.status as MasteryStatus,
          score: Number(m.mastery_score),
          attempts: m.attempts,
        })),
      rank,
    ),
    lettersToReview: (letters.data ?? []).map((r) => {
      const g = one(r.handwriting_glyphs);
      return { character: g?.character ?? "", name: g?.name ?? "" };
    }),
  };
}

export type WritingReport = Awaited<ReturnType<typeof loadWritingReport>>;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// ---- admin ------------------------------------------------------------------------------

// The writing content for admins (their own session; RLS lets admins read drafts and
// rubrics): writing skills with the curriculum skills tagged, glyphs with their review
// flags, rubric templates and how many writing questions of each type are published.
export async function loadWritingAdmin() {
  const supabase = await createClient();
  const [skills, tagged, glyphs, rubrics, questions, flags] = await Promise.all([
    supabase
      .from("writing_skill_types")
      .select("code, name, strand, emoji, min_level_rank, max_level_rank, status, sort_order")
      .order("sort_order"),
    supabase
      .from("skills")
      .select("writing_skill_code")
      .not("writing_skill_code", "is", null)
      .eq("status", "published"),
    supabase.from("handwriting_glyphs").select(`${GLYPH_ADMIN_COLUMNS}`).order("sort_order"),
    supabase
      .from("writing_rubrics")
      .select("code, name, description, min_level_rank, max_level_rank, criteria, status")
      .order("min_level_rank")
      .order("code"),
    supabase
      .from("questions")
      .select("question_type")
      .in("question_type", [...WRITING_TYPES, "SPELLING"])
      .eq("status", "published")
      .limit(5000),
    supabase
      .from("content_flags")
      .select("entity, entity_key, message, severity")
      .in("entity", ["glyph", "writing_rubric"]),
  ]);
  for (const r of [skills, tagged, glyphs, rubrics, questions, flags]) if (r.error) throw r.error;
  const taggedCount = new Map<string, number>();
  for (const s of tagged.data ?? [])
    taggedCount.set(s.writing_skill_code!, (taggedCount.get(s.writing_skill_code!) ?? 0) + 1);
  const questionCount = new Map<string, number>();
  for (const q of questions.data ?? [])
    questionCount.set(q.question_type, (questionCount.get(q.question_type) ?? 0) + 1);
  return {
    skills: (skills.data ?? []).map((s) => ({ ...s, curriculumSkills: taggedCount.get(s.code) ?? 0 })),
    glyphs: (glyphs.data ?? []).map((row) => ({
      row,
      glyph: glyphFromRow(row as GlyphRow),
      flags: (flags.data ?? [])
        .filter((f) => f.entity === "glyph" && f.entity_key === row.code)
        .map((f) => f.message),
    })),
    rubrics: (rubrics.data ?? []).map((r) => ({
      ...r,
      criteria: (Array.isArray(r.criteria) ? r.criteria : []) as {
        id: string;
        dimension: string;
        label: string;
        critical: boolean | "level";
      }[],
    })),
    questionCount: Object.fromEntries(questionCount),
  };
}

export async function loadAdminGlyph(code: string) {
  if (!/^[a-z0-9-]{2,60}$/.test(code)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("handwriting_glyphs")
    .select(GLYPH_ADMIN_COLUMNS)
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [{ count }, flags] = await Promise.all([
    supabase.from("questions").select("id", { count: "exact", head: true }).eq("glyph_id", data.id),
    supabase.from("content_flags").select("message").eq("entity", "glyph").eq("entity_key", code),
  ]);
  return {
    row: data,
    glyph: glyphFromRow(data as GlyphRow),
    questions: count ?? 0,
    flags: (flags.data ?? []).map((f) => f.message),
  };
}

const GLYPH_ADMIN_COLUMNS = `${GLYPH_COLUMNS}, status, difficulty, family, sort_order`;
