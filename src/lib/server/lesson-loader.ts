import "server-only";

import { parseActivityConfig } from "@/lib/content/activity-config";
import { parseQuestion, type ParsedQuestion } from "@/lib/content/question-schemas";
import { isRenderableQuestionType } from "@/features/activities/supported-types";
import { buildAnswerKey } from "@/lib/learning/answer-key";
import type { FeedbackKind, FeedbackMessage } from "@/lib/learning/feedback";
import type { ClientQuestion, LessonPattern, LessonPayload, LessonStep } from "@/lib/learning/lesson-payload";
import { logger } from "@/lib/logging";
import { loadLearningRules } from "@/lib/server/learning-rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Loads a published lesson and turns it into a validated LessonPayload.
//
// Everything is read with the signed-in parent's RLS client, so only published content
// is visible — except the answers: signed-in users have no SELECT on questions.answer,
// so they are read with the service role, for exactly the question ids RLS returned, and
// turned into digest-only answer keys. Plaintext answers never leave the server.
//
// Questions whose stored content fails validation, whose type has no renderer yet, or
// whose activity configuration is invalid are skipped and logged for admins, so a
// content mistake never breaks a child's lesson.
export async function loadLessonPayload(lessonId: string): Promise<LessonPayload | null> {
  if (!/^[0-9a-f-]{36}$/i.test(lessonId)) return null;
  const supabase = await createClient();

  const { data: lesson } = await supabase
    .from("lessons")
    .select(
      "id, code, title, child_title, description, emoji, version, skill_id, status, estimated_minutes, difficulty, intro_speech, skills(title, child_title, units(subjects(name), levels(name)))",
    )
    .eq("id", lessonId)
    .eq("status", "published")
    .maybeSingle();
  if (!lesson) return null;

  const { data: activities, error: activitiesError } = await supabase
    .from("activities")
    .select("id, activity_type, title, instructions, instructions_speech, stage, config, sort_order")
    .eq("lesson_id", lesson.id)
    .eq("status", "published")
    .order("sort_order");
  if (activitiesError) throw activitiesError;
  const activityIds = (activities ?? []).map((a) => a.id);
  if (activityIds.length === 0) return null;

  const [{ data: questions, error: questionsError }, feedbackRows, rules] = await Promise.all([
    supabase
      .from("questions")
      .select(
        "id, activity_id, skill_id, question_type, prompt, prompt_speech, content, explanation, word_id, phonics_pattern_id, version, sort_order",
      )
      .in("activity_id", activityIds)
      .eq("status", "published")
      .order("sort_order"),
    supabase
      .from("feedback_messages")
      .select("kind, text, speech, emoji")
      .eq("status", "published")
      .order("sort_order"),
    loadLearningRules(supabase),
  ]);
  if (questionsError) throw questionsError;
  if (feedbackRows.error) throw feedbackRows.error;

  const answers = new Map<string, unknown>();
  if ((questions ?? []).length > 0) {
    const { data: answerRows, error: answersError } = await createAdminClient()
      .from("questions")
      .select("id, answer")
      .in(
        "id",
        (questions ?? []).map((q) => q.id),
      )
      .eq("status", "published");
    if (answersError) throw answersError;
    for (const row of answerRows ?? []) answers.set(row.id, row.answer);
  }

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
    const config = parseActivityConfig(activity.activity_type, activity.config);
    if (!config.ok) {
      logger.warn("lesson.activity_invalid", { lessonId, activityId: activity.id, reason: config.error });
      continue;
    }
    for (const q of (questions ?? []).filter((x) => x.activity_id === activity.id)) {
      if (!isRenderableQuestionType(q.question_type)) {
        logger.warn("lesson.question_skipped", {
          lessonId,
          questionId: q.id,
          reason: `no renderer for ${q.question_type}`,
        });
        continue;
      }
      const parsed = parseQuestion(q.question_type, q.content, answers.get(q.id) ?? null);
      if (!parsed.ok) {
        logger.warn("lesson.question_invalid", { lessonId, questionId: q.id, reason: parsed.error });
        continue;
      }
      const scored = parsed.question.answer !== null;
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
        scored,
        question: toClientQuestion(parsed.question),
        answerKey: await buildAnswerKey(q.question_type, parsed.question.answer, crypto.randomUUID()),
        maxTries: config.config.maxTries ?? rules.player.maxTries,
        explanation: q.explanation,
        activityConfig: config.config,
        pattern: q.phonics_pattern_id ? (patterns.get(q.phonics_pattern_id) ?? null) : null,
        tileSounds: q.question_type === "WORD_BUILDER" ? tileSounds : {},
      });
    }
  }
  if (steps.length === 0) return null;

  const skill = one(lesson.skills);
  const unit = one(skill?.units);
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
      description: lesson.description,
      introSpeech: lesson.intro_speech,
      estimatedMinutes: lesson.estimated_minutes,
      difficulty: lesson.difficulty,
      subjectName: one(unit?.subjects)?.name ?? "",
      levelName: one(unit?.levels)?.name ?? "",
    },
    steps,
    feedback: (feedbackRows.data ?? []).map((m): FeedbackMessage => ({
      kind: m.kind as FeedbackKind,
      text: m.text,
      speech: m.speech,
      emoji: m.emoji,
    })),
    rules: { player: rules.player, scoring: rules.scoring },
    loadedAt: new Date().toISOString(),
  };
}

// Drops the answer. Listening types need the spoken word itself (the child has to hear
// it), so it is filled in from the answer when the content does not name it.
function toClientQuestion(question: ParsedQuestion): ClientQuestion {
  if ((question.type === "WORD_BUILDER" || question.type === "SPELLING") && !question.content.speech) {
    return {
      type: question.type,
      content: { ...question.content, speech: question.answer.accepted[0] },
    } as ClientQuestion;
  }
  const { answer: _answer, ...rest } = question;
  return rest as ClientQuestion;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
