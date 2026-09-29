import "server-only";

import { parseQuestion } from "@/lib/content/question-schemas";
import type { LessonPattern, LessonPayload, LessonStep } from "@/lib/learning/lesson-payload";
import { isRenderableQuestionType } from "@/features/activities/supported-types";
import { logger } from "@/lib/logging";
import { createClient } from "@/lib/supabase/server";

// Loads a published lesson and turns it into a validated LessonPayload. Questions whose
// stored content fails validation, or whose type has no renderer yet, are skipped and
// logged for admins, so a content mistake never breaks a child's lesson.
export async function loadLessonPayload(lessonId: string): Promise<LessonPayload | null> {
  if (!/^[0-9a-f-]{36}$/i.test(lessonId)) return null;
  const supabase = await createClient();

  const { data: lesson } = await supabase
    .from("lessons")
    .select("id, code, title, child_title, emoji, version, skill_id, status, skills(title, child_title)")
    .eq("id", lessonId)
    .eq("status", "published")
    .maybeSingle();
  if (!lesson) return null;

  const { data: activities, error: activitiesError } = await supabase
    .from("activities")
    .select("id, title, instructions, instructions_speech, stage, sort_order")
    .eq("lesson_id", lesson.id)
    .eq("status", "published")
    .order("sort_order");
  if (activitiesError) throw activitiesError;
  const activityIds = (activities ?? []).map((a) => a.id);
  if (activityIds.length === 0) return null;

  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select(
      "id, activity_id, skill_id, question_type, prompt, prompt_speech, content, answer, word_id, phonics_pattern_id, version, sort_order",
    )
    .in("activity_id", activityIds)
    .eq("status", "published")
    .order("sort_order");
  if (questionsError) throw questionsError;

  const patternIds = [
    ...new Set((questions ?? []).map((q) => q.phonics_pattern_id).filter((id): id is string => !!id)),
  ];
  const patterns = new Map<string, LessonPattern>();
  if (patternIds.length > 0) {
    const { data: patternRows } = await supabase
      .from("phonics_patterns")
      .select(
        "id, code, pattern, pattern_type, child_explanation, phonics_pattern_sounds(code, label, say_as, ipa, sort_order)",
      )
      .in("id", patternIds);
    for (const p of patternRows ?? []) {
      patterns.set(p.id, {
        code: p.code,
        pattern: p.pattern,
        type: p.pattern_type,
        childExplanation: p.child_explanation,
        sounds: [...(p.phonics_pattern_sounds ?? [])]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((s) => ({ code: s.code, label: s.label, sayAs: s.say_as, ipa: s.ipa })),
      });
    }
  }

  // Sounds for word-builder tiles (single letters and digraphs, primary sound).
  const tiles = new Set<string>();
  for (const q of questions ?? []) {
    if (q.question_type !== "WORD_BUILDER") continue;
    const content = q.content as { tiles?: unknown };
    if (Array.isArray(content.tiles))
      for (const t of content.tiles) if (typeof t === "string") tiles.add(t.toLowerCase());
  }
  const tileSounds: Record<string, string> = {};
  if (tiles.size > 0) {
    const { data: tilePatterns } = await supabase
      .from("phonics_patterns")
      .select("pattern, pattern_type, phonics_pattern_sounds(say_as, is_primary)")
      .in("pattern", [...tiles])
      .in("pattern_type", ["letter", "consonant_digraph", "vowel_team", "r_controlled", "trigraph"])
      .eq("status", "published");
    for (const p of tilePatterns ?? []) {
      const primary = (p.phonics_pattern_sounds ?? []).find((x) => x.is_primary);
      // A single letter's own pattern wins over e.g. an ending with the same text.
      if (primary && (!tileSounds[p.pattern] || p.pattern_type === "letter"))
        tileSounds[p.pattern] = primary.say_as;
    }
  }

  const steps: LessonStep[] = [];
  for (const activity of activities ?? []) {
    for (const q of (questions ?? []).filter((x) => x.activity_id === activity.id)) {
      if (!isRenderableQuestionType(q.question_type)) {
        logger.warn("lesson.question_skipped", {
          lessonId,
          questionId: q.id,
          reason: `no renderer for ${q.question_type}`,
        });
        continue;
      }
      const parsed = parseQuestion(q.question_type, q.content, q.answer);
      if (!parsed.ok) {
        logger.warn("lesson.question_invalid", { lessonId, questionId: q.id, reason: parsed.error });
        continue;
      }
      steps.push({
        questionId: q.id,
        questionVersion: q.version,
        activityId: activity.id,
        activityTitle: activity.title,
        instructions: activity.instructions,
        instructionsSpeech: activity.instructions_speech,
        stage: activity.stage,
        prompt: q.prompt,
        promptSpeech: q.prompt_speech,
        skillId: q.skill_id,
        wordId: q.word_id,
        scored: parsed.question.answer !== null,
        question: parsed.question,
        pattern: q.phonics_pattern_id ? (patterns.get(q.phonics_pattern_id) ?? null) : null,
        tileSounds: q.question_type === "WORD_BUILDER" ? tileSounds : {},
      });
    }
  }
  if (steps.length === 0) return null;

  const skill = Array.isArray(lesson.skills) ? lesson.skills[0] : lesson.skills;
  return {
    lesson: {
      id: lesson.id,
      code: lesson.code,
      title: lesson.title,
      childTitle: lesson.child_title || lesson.title,
      emoji: lesson.emoji,
      version: lesson.version,
      skillId: lesson.skill_id,
      skillTitle: skill?.child_title || skill?.title || "",
    },
    steps,
    loadedAt: new Date().toISOString(),
  };
}
