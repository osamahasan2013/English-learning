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
      .select(QUESTION_COLUMNS)
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

  const support = await loadQuestionSupport(supabase, questions ?? []);

  const steps: LessonStep[] = [];
  for (const activity of activities ?? []) {
    const config = parseActivityConfig(activity.activity_type, activity.config);
    if (!config.ok) {
      logger.warn("lesson.activity_invalid", { lessonId, activityId: activity.id, reason: config.error });
      continue;
    }
    for (const q of (questions ?? []).filter((x) => x.activity_id === activity.id)) {
      const step = await buildStep(q, support, lessonId, {
        activityId: activity.id,
        activityTitle: activity.title,
        instructions: activity.instructions,
        instructionsSpeech: activity.instructions_speech,
        stage: activity.stage,
        config: config.config,
        maxTries: config.config.maxTries ?? rules.player.maxTries,
        explanation: q.explanation,
      });
      if (step) steps.push(step);
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
    feedback: toFeedback(feedbackRows.data ?? []),
    rules: { player: rules.player, scoring: rules.scoring },
    loadedAt: new Date().toISOString(),
  };
}

// A published assessment (e.g. the Phonics Check) as a player payload: one step per item,
// in stage order, one try each and no teaching explanations. Answers become digest-only
// keys exactly as for lessons.
export async function loadAssessmentPayload(code: string): Promise<LessonPayload | null> {
  if (!/^[a-z0-9-]{2,80}$/.test(code)) return null;
  const supabase = await createClient();
  const { data: assessment } = await supabase
    .from("assessments")
    .select("id, code, title, description, config, version")
    .eq("code", code)
    .eq("status", "published")
    .maybeSingle();
  if (!assessment) return null;
  const { data: items, error: itemsError } = await supabase
    .from("assessment_items")
    .select("question_id, stage, stage_label, sort_order")
    .eq("assessment_id", assessment.id)
    .order("stage")
    .order("sort_order");
  if (itemsError) throw itemsError;
  if (!items?.length) return null;

  const [{ data: questions, error: questionsError }, feedbackRows, rules] = await Promise.all([
    supabase
      .from("questions")
      .select(QUESTION_COLUMNS)
      .in(
        "id",
        items.map((i) => i.question_id),
      )
      .eq("status", "published"),
    supabase
      .from("feedback_messages")
      .select("kind, text, speech, emoji")
      .eq("status", "published")
      .order("sort_order"),
    loadLearningRules(supabase),
  ]);
  if (questionsError) throw questionsError;
  if (feedbackRows.error) throw feedbackRows.error;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const support = await loadQuestionSupport(supabase, questions ?? []);

  const steps: LessonStep[] = [];
  const areas: { stage: number; label: string }[] = [];
  for (const item of items) {
    const q = byId.get(item.question_id);
    if (!q) continue;
    const config = parseActivityConfig(q.question_type, {});
    if (!config.ok) continue;
    const step = await buildStep(q, support, assessment.id, {
      activityId: `${assessment.id}:${item.stage}`,
      activityTitle: item.stage_label,
      instructions: item.stage_label,
      instructionsSpeech: "",
      stage: "assessment",
      config: config.config,
      maxTries: 1,
      explanation: "",
    });
    if (!step) continue;
    steps.push(step);
    if (!areas.some((a) => a.stage === item.stage))
      areas.push({ stage: item.stage, label: item.stage_label });
  }
  if (steps.length === 0) return null;

  const config = (assessment.config ?? {}) as { childTitle?: unknown; emoji?: unknown };
  const childTitle = typeof config.childTitle === "string" ? config.childTitle : assessment.title;
  return {
    lesson: {
      id: assessment.id,
      code: assessment.code,
      title: assessment.title,
      childTitle,
      emoji: typeof config.emoji === "string" ? config.emoji : "🎯",
      version: assessment.version,
      skillId: steps[0].skillId,
      skillTitle: "",
      description: "Show what you know! Just do your best.",
      introSpeech: `${childTitle}. Show what you know! Listen, then do your best. There is one try for each question.`,
      estimatedMinutes: Math.max(3, Math.round(steps.length / 3)),
      difficulty: 1,
      subjectName: "Phonics",
      levelName: "",
    },
    assessment: { id: assessment.id, code: assessment.code, areas },
    steps,
    feedback: toFeedback(feedbackRows.data ?? []),
    rules: { player: rules.player, scoring: rules.scoring },
    loadedAt: new Date().toISOString(),
  };
}

const QUESTION_COLUMNS =
  "id, activity_id, skill_id, question_type, prompt, prompt_speech, content, explanation, word_id, phonics_pattern_id, version, sort_order";

type QuestionRow = {
  id: string;
  skill_id: string;
  question_type: string;
  prompt: string;
  prompt_speech: string;
  content: unknown;
  word_id: string | null;
  phonics_pattern_id: string | null;
  version: number;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

type QuestionSupport = {
  answers: Map<string, unknown>;
  patterns: Map<string, LessonPattern>;
  tileSounds: Record<string, string>;
};

// Answers (service role, for exactly these RLS-visible question ids), phonics patterns and
// word-builder tile sounds for a set of questions.
async function loadQuestionSupport(supabase: Supabase, questions: QuestionRow[]): Promise<QuestionSupport> {
  const answers = new Map<string, unknown>();
  if (questions.length > 0) {
    const { data: answerRows, error: answersError } = await createAdminClient()
      .from("questions")
      .select("id, answer")
      .in(
        "id",
        questions.map((q) => q.id),
      )
      .eq("status", "published");
    if (answersError) throw answersError;
    for (const row of answerRows ?? []) answers.set(row.id, row.answer);
  }

  const patternIds = [
    ...new Set(questions.map((q) => q.phonics_pattern_id).filter((id): id is string => !!id)),
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

  return { answers, patterns, tileSounds };
}

async function buildStep(
  q: QuestionRow,
  support: QuestionSupport,
  ownerId: string,
  context: Pick<
    LessonStep,
    | "activityId"
    | "activityTitle"
    | "instructions"
    | "instructionsSpeech"
    | "stage"
    | "maxTries"
    | "explanation"
  > & { config: LessonStep["activityConfig"] },
): Promise<LessonStep | null> {
  if (!isRenderableQuestionType(q.question_type)) {
    logger.warn("lesson.question_skipped", {
      lessonId: ownerId,
      questionId: q.id,
      reason: `no renderer for ${q.question_type}`,
    });
    return null;
  }
  const parsed = parseQuestion(q.question_type, q.content, support.answers.get(q.id) ?? null);
  if (!parsed.ok) {
    logger.warn("lesson.question_invalid", { lessonId: ownerId, questionId: q.id, reason: parsed.error });
    return null;
  }
  const { config, ...rest } = context;
  return {
    ...rest,
    questionId: q.id,
    questionVersion: q.version,
    prompt: q.prompt,
    promptSpeech: q.prompt_speech,
    skillId: q.skill_id,
    wordId: q.word_id,
    scored: parsed.question.answer !== null,
    question: toClientQuestion(parsed.question),
    answerKey: await buildAnswerKey(q.question_type, parsed.question.answer, crypto.randomUUID()),
    activityConfig: config,
    pattern: q.phonics_pattern_id ? (support.patterns.get(q.phonics_pattern_id) ?? null) : null,
    tileSounds: q.question_type === "WORD_BUILDER" ? support.tileSounds : {},
  };
}

function toFeedback(
  rows: { kind: string; text: string; speech: string; emoji: string }[],
): FeedbackMessage[] {
  return rows.map((m) => ({ kind: m.kind as FeedbackKind, text: m.text, speech: m.speech, emoji: m.emoji }));
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
