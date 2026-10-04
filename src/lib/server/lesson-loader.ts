import "server-only";

import { parseActivityConfig } from "@/lib/content/activity-config";
import { soundToken } from "@/lib/audio/pronunciation";
import { getSoundTable } from "@/lib/server/sound-table";
import { parseQuestion, type ParsedQuestion } from "@/lib/content/question-schemas";
import { isRenderableQuestionType } from "@/features/activities/supported-types";
import { buildAnswerKey } from "@/lib/learning/answer-key";
import { pickPracticeQuestions, wordAreaFor, type WordArea } from "@/lib/learning/vocabulary";
import {
  resolveSpellingSettings,
  spellingActivityOf,
  SPELLING_ANALYSIS_TYPES,
  type SpellingActivity,
} from "@/lib/learning/spelling";
import type { LearningRules } from "@/lib/learning/rules";
import { glyphFromRow, GLYPH_COLUMNS } from "@/lib/server/glyphs";
import type { TraceGlyph } from "@/lib/learning/tracing";
import { resolveWritingSettings, WRITING_QUESTION_TYPES } from "@/lib/learning/writing-evaluation";
import type { FeedbackKind, FeedbackMessage } from "@/lib/learning/feedback";
import type { ClientQuestion, LessonPattern, LessonPayload, LessonStep } from "@/lib/learning/lesson-payload";
import { logger } from "@/lib/logging";
import { loadLearningRules } from "@/lib/server/learning-rules";
import { loadPassages } from "@/lib/server/reading";
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
      "id, code, title, child_title, description, emoji, version, skill_id, status, estimated_minutes, difficulty, intro_speech, skills(title, child_title, units(subjects(name), levels(name, code)))",
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
      .select("kind, text, speech, emoji, error_category")
      .eq("status", "published")
      .order("sort_order"),
    loadLearningRules(supabase),
  ]);
  if (questionsError) throw questionsError;
  if (feedbackRows.error) throw feedbackRows.error;

  const support = await loadQuestionSupport(supabase, questions ?? []);
  const levelCode = one(one(one(lesson.skills)?.units)?.levels)?.code ?? null;

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
        levelCode,
        rules,
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
    sounds: await getSoundTable(),
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
      .select("kind, text, speech, emoji, error_category")
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
      levelCode: null,
      rules,
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
    sounds: await getSoundTable(),
    rules: { player: rules.player, scoring: rules.scoring },
    loadedAt: new Date().toISOString(),
  };
}

// Word practice: published questions about the given words (most urgent first), from
// published activities of published lessons, varied by area and at most
// `vocabulary.practiceQuestions` long. Only an `area` filter (spelling, listening…) can
// narrow it. RLS decides what is visible; answers become digest keys as for lessons.
export async function loadWordPracticePayload(args: {
  wordIds: string[];
  area?: WordArea;
  kind: "word" | "my_words";
  title: string;
  emoji: string;
  returnHref: string;
  // The child's level: spelling steps take its input method and hints.
  levelCode?: string | null;
}): Promise<LessonPayload | null> {
  const wordIds = args.wordIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 50);
  if (wordIds.length === 0) return null;
  const supabase = await createClient();
  const [{ data: rows, error }, feedbackRows, rules] = await Promise.all([
    supabase
      .from("questions")
      .select(
        `${QUESTION_COLUMNS}, metadata, activities!inner(id, title, instructions, instructions_speech, stage, activity_type, config, status, lessons!inner(status))`,
      )
      .in("word_id", wordIds)
      .eq("status", "published")
      .eq("activities.status", "published")
      .eq("activities.lessons.status", "published")
      .neq("question_type", "INTRO")
      .order("sort_order")
      .limit(400),
    supabase
      .from("feedback_messages")
      .select("kind, text, speech, emoji, error_category")
      .eq("status", "published")
      .order("sort_order"),
    loadLearningRules(supabase),
  ]);
  if (error) throw error;
  if (feedbackRows.error) throw feedbackRows.error;
  const candidates = (rows ?? [])
    .map((q) => ({ ...q, wordId: q.word_id, area: wordAreaFor(q.question_type, q.metadata) }))
    .filter((q) => !args.area || q.area === args.area);
  // One word gets the whole session; several words share it (at least two questions each).
  const limit = rules.vocabulary.practiceQuestions;
  const picked = pickPracticeQuestions(
    candidates,
    wordIds,
    limit,
    Math.max(2, Math.ceil(limit / wordIds.length)),
  );
  if (picked.length === 0) return null;

  const support = await loadQuestionSupport(supabase, picked);
  const steps: LessonStep[] = [];
  for (const q of picked) {
    const activity = one(q.activities);
    if (!activity) continue;
    const config = parseActivityConfig(activity.activity_type, activity.config);
    if (!config.ok) continue;
    const step = await buildStep(q, support, "word-practice", {
      activityId: activity.id,
      activityTitle: activity.title,
      instructions: activity.instructions,
      instructionsSpeech: activity.instructions_speech,
      stage: activity.stage,
      config: config.config,
      maxTries: config.config.maxTries ?? rules.player.maxTries,
      explanation: q.explanation,
      levelCode: args.levelCode ?? null,
      rules,
    });
    if (step) steps.push(step);
  }
  if (steps.length === 0) return null;

  const key = `practice-${args.kind}-${args.area ?? "all"}-${wordIds.length === 1 ? wordIds[0] : "mine"}`;
  return {
    lesson: {
      id: key,
      code: key,
      title: args.title,
      childTitle: args.title,
      emoji: args.emoji,
      version: 1,
      skillId: steps[0].skillId,
      skillTitle: "",
      description: "Practice your words.",
      introSpeech: `${args.title}. Let's practice!`,
      estimatedMinutes: Math.max(2, Math.round(steps.length / 2)),
      difficulty: 1,
      subjectName: "Vocabulary",
      levelName: "",
    },
    practice: { kind: args.kind, returnHref: args.returnHref, wordIds },
    steps,
    feedback: toFeedback(feedbackRows.data ?? []),
    sounds: await getSoundTable(),
    rules: { player: rules.player, scoring: rules.scoring },
    loadedAt: new Date().toISOString(),
  };
}

// Spelling practice, dictation and spelling review: published spelling questions from
// published lessons — about the chosen words (most urgent first), or, for dictation, from
// the lessons of the given spelling skills — at most `spelling.practiceQuestions` long and
// varied by activity. Played in the ordinary lesson player with no lesson run, like word
// practice; answers become digest keys as for lessons.
export async function loadSpellingPracticePayload(args: {
  wordIds?: string[];
  skillIds?: string[];
  activities?: SpellingActivity[];
  kind: "spelling" | "dictation";
  title: string;
  emoji: string;
  returnHref: string;
  returnLabel: string;
  levelCode: string | null;
  now?: Date;
}): Promise<LessonPayload | null> {
  const isId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
  const wordIds = (args.wordIds ?? []).filter(isId).slice(0, 50);
  const skillIds = (args.skillIds ?? []).filter(isId).slice(0, 100);
  if (wordIds.length === 0 && skillIds.length === 0) return null;
  const supabase = await createClient();
  let query = supabase
    .from("questions")
    .select(
      `${QUESTION_COLUMNS}, activities!inner(id, title, instructions, instructions_speech, stage, activity_type, config, status, lessons!inner(status))`,
    )
    .eq("status", "published")
    .eq("activities.status", "published")
    .eq("activities.lessons.status", "published")
    .neq("question_type", "INTRO");
  query = wordIds.length > 0 ? query.in("word_id", wordIds) : query.in("skill_id", skillIds);
  if (args.activities?.length) query = query.in("metadata->>spellingActivity", args.activities);
  const [{ data: rows, error }, feedbackRows, rules] = await Promise.all([
    query.order("sort_order").limit(400),
    supabase
      .from("feedback_messages")
      .select("kind, text, speech, emoji, error_category")
      .eq("status", "published")
      .order("sort_order"),
    loadLearningRules(supabase),
  ]);
  if (error) throw error;
  if (feedbackRows.error) throw feedbackRows.error;
  const candidates = (rows ?? [])
    .map((q) => ({ ...q, wordId: q.word_id, activity: spellingActivityOf(q.metadata) }))
    .filter((q) => q.activity !== null || wordAreaFor(q.question_type, q.metadata) === "spelling");
  const limit = rules.spelling.practiceQuestions;
  let picked: typeof candidates;
  if (wordIds.length > 0) {
    picked = pickPracticeQuestions(
      candidates.map((q) => ({ ...q, area: (q.activity ?? "spelling") as WordArea })),
      wordIds,
      limit,
      Math.max(2, Math.ceil(limit / wordIds.length)),
    );
  } else {
    // A different selection each day, the same all day (a reload does not reshuffle).
    const day = (args.now ?? new Date()).toISOString().slice(0, 10);
    const rank = (id: string) => {
      let h = 2166136261;
      for (const ch of `${day}:${id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      return h >>> 0;
    };
    picked = [...candidates].sort((a, b) => rank(a.id) - rank(b.id)).slice(0, limit);
  }
  if (picked.length === 0) return null;

  const support = await loadQuestionSupport(supabase, picked);
  const steps: LessonStep[] = [];
  for (const q of picked) {
    const activity = one(q.activities);
    if (!activity) continue;
    const config = parseActivityConfig(activity.activity_type, activity.config);
    if (!config.ok) continue;
    const step = await buildStep(q, support, `${args.kind}-practice`, {
      activityId: activity.id,
      activityTitle: activity.title,
      instructions: activity.instructions,
      instructionsSpeech: activity.instructions_speech,
      stage: activity.stage,
      config: config.config,
      maxTries: config.config.maxTries ?? rules.player.maxTries,
      explanation: q.explanation,
      levelCode: args.levelCode,
      rules,
    });
    if (step) steps.push(step);
  }
  if (steps.length === 0) return null;

  const key = `practice-${args.kind}-${wordIds.length === 1 ? wordIds[0] : wordIds.length > 0 ? "words" : "level"}`;
  return {
    lesson: {
      id: key,
      code: key,
      title: args.title,
      childTitle: args.title,
      emoji: args.emoji,
      version: 1,
      skillId: steps[0].skillId,
      skillTitle: "",
      description: args.kind === "dictation" ? "Listen carefully, then write." : "Practice your spelling.",
      introSpeech: `${args.title}. ${args.kind === "dictation" ? "Listen carefully, then write." : "Let's practice spelling!"}`,
      estimatedMinutes: Math.max(2, Math.round(steps.length / 2)),
      difficulty: 1,
      subjectName: "Spelling",
      levelName: "",
    },
    practice: { kind: args.kind, returnHref: args.returnHref, returnLabel: args.returnLabel, wordIds },
    steps,
    feedback: toFeedback(feedbackRows.data ?? []),
    sounds: await getSoundTable(),
    rules: { player: rules.player, scoring: rules.scoring },
    loadedAt: new Date().toISOString(),
  };
}

const QUESTION_COLUMNS =
  "id, activity_id, skill_id, question_type, prompt, prompt_speech, content, explanation, word_id, phonics_pattern_id, version, sort_order, metadata";

type QuestionRow = {
  id: string;
  explanation?: string;
  skill_id: string;
  question_type: string;
  prompt: string;
  prompt_speech: string;
  content: unknown;
  word_id: string | null;
  phonics_pattern_id: string | null;
  version: number;
  metadata?: unknown;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

type QuestionSupport = {
  answers: Map<string, unknown>;
  patterns: Map<string, LessonPattern>;
  tileSounds: Record<string, string>;
  // Published story passages by code (loaded once per payload, on first use).
  passage: (code: string) => Promise<LessonStep["passage"]>;
  // Published handwriting glyphs by code, for the handwriting questions of this payload.
  glyphs: Map<string, TraceGlyph>;
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
        "id, code, pattern, pattern_type, child_explanation, phonics_pattern_sounds(code, label, phonemes, ipa, sort_order)",
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
          .map((s) => ({ code: s.code, label: s.label, sayAs: soundToken(s.phonemes), ipa: s.ipa })),
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
      .select("pattern, pattern_type, phonics_pattern_sounds(phonemes, is_primary)")
      .in("pattern", [...tiles])
      .in("pattern_type", ["letter", "consonant_digraph", "vowel_team", "r_controlled", "trigraph"])
      .eq("status", "published");
    for (const p of tilePatterns ?? []) {
      const primary = (p.phonics_pattern_sounds ?? []).find((x) => x.is_primary);
      // A single letter's own pattern wins over e.g. an ending with the same text.
      if (primary && (!tileSounds[p.pattern] || p.pattern_type === "letter"))
        tileSounds[p.pattern] = soundToken(primary.phonemes);
    }
  }

  const passages = new Map<string, Promise<LessonStep["passage"]>>();
  const passage = (code: string) => {
    if (!passages.has(code))
      passages.set(
        code,
        loadPassages(supabase, [code]).then((m) => m.get(code) ?? null),
      );
    return passages.get(code)!;
  };

  // Glyphs: only the letters these questions practise (each a few hundred numbers).
  const glyphCodes = new Set<string>();
  for (const q of questions) {
    if (q.question_type !== "TRACING") continue;
    const code = (q.content as { glyph?: unknown }).glyph;
    if (typeof code === "string") glyphCodes.add(code);
  }
  const glyphs = new Map<string, TraceGlyph>();
  if (glyphCodes.size > 0) {
    const { data: glyphRows, error: glyphError } = await supabase
      .from("handwriting_glyphs")
      .select(GLYPH_COLUMNS)
      .in("code", [...glyphCodes])
      .eq("status", "published");
    if (glyphError) throw glyphError;
    for (const row of glyphRows ?? []) {
      const glyph = glyphFromRow(row);
      if (glyph) glyphs.set(glyph.code, glyph);
    }
  }

  return { answers, patterns, tileSounds, passage, glyphs };
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
  > & { config: LessonStep["activityConfig"]; levelCode: string | null; rules: LearningRules },
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
  const { config, levelCode, rules, ...rest } = context;
  // A story the activity is about: without it (a draft story) the text step cannot run.
  const passage = config.story ? await support.passage(config.story) : null;
  if (config.story && !passage) {
    logger.warn("lesson.story_unavailable", { lessonId: ownerId, questionId: q.id, reason: config.story });
    if (q.question_type === "READ_PASSAGE") return null;
  }
  // Writing: the level's expectations, and for handwriting the glyph (a letter that is not
  // published cannot be traced, so the step is skipped).
  const isWriting = WRITING_QUESTION_TYPES.has(q.question_type);
  const writing = isWriting ? resolveWritingSettings(levelCode, rules.writing) : null;
  const glyph =
    parsed.question.type === "TRACING" ? (support.glyphs.get(parsed.question.content.glyph) ?? null) : null;
  if (parsed.question.type === "TRACING" && !glyph) {
    logger.warn("lesson.glyph_unavailable", {
      lessonId: ownerId,
      questionId: q.id,
      reason: parsed.question.content.glyph,
    });
    return null;
  }
  const activity = spellingActivityOf(q.metadata);
  const spelling =
    activity || SPELLING_ANALYSIS_TYPES.has(q.question_type)
      ? resolveSpellingSettings({ config, levelCode, activity, rules })
      : null;
  return {
    ...rest,
    spelling,
    questionId: q.id,
    questionVersion: q.version,
    prompt: q.prompt,
    promptSpeech: q.prompt_speech,
    skillId: q.skill_id,
    wordId: q.word_id,
    scored: parsed.question.answer !== null,
    question: toClientQuestion(parsed.question),
    answerKey: await buildAnswerKey(
      q.question_type,
      parsed.question.answer,
      crypto.randomUUID(),
      writing ? { content: parsed.question.content, glyph, settings: writing } : undefined,
    ),
    glyph,
    writing,
    activityConfig: config,
    passage,
    pattern: q.phonics_pattern_id ? (support.patterns.get(q.phonics_pattern_id) ?? null) : null,
    tileSounds: q.question_type === "WORD_BUILDER" ? support.tileSounds : {},
  };
}

function toFeedback(
  rows: { kind: string; text: string; speech: string; emoji: string; error_category?: string | null }[],
): FeedbackMessage[] {
  return rows.map((m) => ({
    kind: m.kind as FeedbackKind,
    text: m.text,
    speech: m.speech,
    emoji: m.emoji,
    errorCategory: m.error_category ?? null,
  }));
}

// Drops the answer. Listening types need the spoken word itself (the child has to hear
// it), so it is filled in from the answer when the content does not name it.
function toClientQuestion(question: ParsedQuestion): ClientQuestion {
  // A sound-to-letter question says its sound (content.sounds), never the letters.
  const grapheme = question.type === "SPELLING" && question.content.mode === "grapheme";
  if (
    (question.type === "WORD_BUILDER" || question.type === "SPELLING") &&
    !question.content.speech &&
    !grapheme
  ) {
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
