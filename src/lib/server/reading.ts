import "server-only";

import { publicAudioUrl, publicImageUrl } from "@/lib/content/media";
import { getPublicEnv } from "@/lib/env";
import type { ReadingPassage } from "@/lib/learning/lesson-payload";
import { wordForms } from "@/lib/content/word-bank";
import type { MasteryStatus } from "@/lib/learning/mastery";
import {
  baseFormCandidates,
  comprehensionBySkill,
  comprehensionByStory,
  normalizeReadingWord,
  paragraphsOf,
  recommendReading,
  runningWords,
  summarizeReadingSessions,
  type ReadingPage,
} from "@/lib/learning/reading";
import { loadLearningRules } from "@/lib/server/learning-rules";
import { createClient } from "@/lib/supabase/server";

// Server-side reading data: story passages for lessons, the child's reading home (library,
// recommendations), the parent's reading report and the admin story list. Everything is
// read with the signed-in user's RLS client, so families only ever see published stories
// and their own children's history.

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Asset = { storage_path: string; status: string; alt_text?: string };

function supabaseUrl() {
  try {
    return getPublicEnv().NEXT_PUBLIC_SUPABASE_URL;
  } catch {
    return null;
  }
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export const PASSAGE_COLUMNS =
  "id, code, title, cover_emoji, pages, word_count, estimated_seconds, content_type_code, reading_content_types(name), image_assets(storage_path, alt_text, status), audio_assets(storage_path, status), story_words(word_id, is_focus, words(normalized_word, plural, inflections, status))";

type WordRef = { normalized_word: string; plural: string | null; inflections: unknown; status: string };

type PassageRow = {
  id: string;
  code: string;
  title: string;
  cover_emoji: string;
  pages: unknown;
  word_count: number;
  estimated_seconds: number | null;
  content_type_code: string | null;
  reading_content_types: { name: string } | { name: string }[] | null;
  image_assets: Asset | Asset[] | null;
  audio_assets: Asset | Asset[] | null;
  story_words:
    | {
        word_id: string;
        is_focus: boolean;
        words: WordRef | WordRef[] | null;
      }[]
    | null;
};

export function toPassage(row: PassageRow): ReadingPassage {
  const base = supabaseUrl();
  const image = one(row.image_assets);
  const audio = one(row.audio_assets);
  const pages = (Array.isArray(row.pages) ? row.pages : []) as ReadingPage[];
  const words: Record<string, string> = {};
  const focusWords: string[] = [];
  const forms: Record<string, string> = {};
  for (const link of row.story_words ?? []) {
    const word = one(link.words);
    if (!word || word.status !== "published") continue;
    words[word.normalized_word] = link.word_id;
    for (const form of wordForms({
      plural: word.plural ?? "",
      inflections: (word.inflections ?? {}) as Record<string, string>,
    }))
      forms[normalizeReadingWord(form)] ??= link.word_id;
    if (link.is_focus) focusWords.push(word.normalized_word);
  }
  const paragraphs = paragraphsOf(pages);
  // Each written form in the text → its word ("naps" → nap, "ran" → run), as the importer
  // matched them.
  for (const w of runningWords(paragraphs)) {
    if (words[w]) continue;
    const id =
      forms[w] ??
      baseFormCandidates(w)
        .map((b) => words[b])
        .find(Boolean);
    if (id) words[w] = id;
  }
  return {
    storyId: row.id,
    code: row.code,
    title: row.title,
    contentType: row.content_type_code ?? "SHORT_STORY",
    contentTypeName: one(row.reading_content_types)?.name ?? "",
    emoji: row.cover_emoji,
    image:
      image && image.status === "published" && base
        ? { url: publicImageUrl(base, image.storage_path), alt: image.alt_text ?? row.title }
        : null,
    audioUrl: audio && audio.status === "published" && base ? publicAudioUrl(base, audio.storage_path) : null,
    paragraphs,
    words,
    focusWords: focusWords.sort(),
    wordCount: row.word_count,
    estimatedSeconds: row.estimated_seconds,
  };
}

// Published passages by story code (RLS: a draft story is simply not found).
export async function loadPassages(
  supabase: Supabase,
  codes: string[],
): Promise<Map<string, ReadingPassage>> {
  const passages = new Map<string, ReadingPassage>();
  const unique = [...new Set(codes)];
  if (unique.length === 0) return passages;
  const { data, error } = await supabase
    .from("stories")
    .select(PASSAGE_COLUMNS)
    .in("code", unique)
    .eq("status", "published");
  if (error) throw error;
  for (const row of (data ?? []) as unknown as PassageRow[]) passages.set(row.code, toPassage(row));
  return passages;
}

// ---------------------------------------------------------------------------------------
// The library: published texts, the lesson that reads each one, and the child's history.

export type LibraryItem = {
  storyId: string;
  code: string;
  title: string;
  summary: string;
  emoji: string;
  levelId: string;
  levelCode: string;
  levelName: string;
  levelRank: number;
  readingLevel: number | null;
  difficulty: number;
  contentType: string;
  contentTypeName: string;
  contentTypeEmoji: string;
  wordCount: number;
  estimatedSeconds: number | null;
  lessonId: string | null;
  // The child's history (null in the admin view).
  readings: number;
  stars: number;
  comprehension: { firstTries: number; correct: number; percent: number } | null;
};

type StoryListRow = {
  id: string;
  code: string;
  title: string;
  summary: string;
  cover_emoji: string;
  level_id: string;
  reading_level: number | null;
  difficulty: number;
  content_type_code: string | null;
  word_count: number;
  estimated_seconds: number | null;
  levels:
    | { code: string; name: string; sort_order: number }
    | { code: string; name: string; sort_order: number }[]
    | null;
  reading_content_types: { name: string; emoji: string } | { name: string; emoji: string }[] | null;
};

const STORY_LIST_COLUMNS =
  "id, code, title, summary, cover_emoji, level_id, reading_level, difficulty, content_type_code, word_count, estimated_seconds, levels(code, name, sort_order), reading_content_types(name, emoji)";

// Story code → the published lesson that reads it (its READ_PASSAGE activity).
async function readingLessons(supabase: Supabase) {
  const { data, error } = await supabase
    .from("activities")
    .select("lesson_id, config, lessons!inner(status)")
    .eq("activity_type", "READ_PASSAGE")
    .eq("status", "published")
    .eq("lessons.status", "published");
  if (error) throw error;
  const byStory = new Map<string, string>();
  for (const a of data ?? []) {
    const story = (a.config as { story?: unknown } | null)?.story;
    if (typeof story === "string" && !byStory.has(story)) byStory.set(story, a.lesson_id);
  }
  return byStory;
}

function toLibraryItem(row: StoryListRow, lessonId: string | null): LibraryItem {
  const level = one(row.levels);
  const type = one(row.reading_content_types);
  return {
    storyId: row.id,
    code: row.code,
    title: row.title,
    summary: row.summary,
    emoji: row.cover_emoji,
    levelId: row.level_id,
    levelCode: level?.code ?? "",
    levelName: level?.name ?? "",
    levelRank: level?.sort_order ?? 0,
    readingLevel: row.reading_level,
    difficulty: row.difficulty,
    contentType: row.content_type_code ?? "SHORT_STORY",
    contentTypeName: type?.name ?? "",
    contentTypeEmoji: type?.emoji ?? "",
    wordCount: row.word_count,
    estimatedSeconds: row.estimated_seconds,
    lessonId,
    readings: 0,
    stars: 0,
    comprehension: null,
  };
}

const byLibraryOrder = (a: LibraryItem, b: LibraryItem) =>
  a.levelRank - b.levelRank ||
  (a.readingLevel ?? a.difficulty * 2) - (b.readingLevel ?? b.difficulty * 2) ||
  a.title.localeCompare(b.title);

// Comprehension first tries on story questions, with the reading skill of each question's
// skill (ordinary attempts; RLS: the parent's own child).
async function comprehensionAttempts(supabase: Supabase, childId: string) {
  const { data, error } = await supabase
    .from("activity_attempts")
    .select("is_correct, attempted_at, questions!inner(story_id, skills(reading_skill_code))")
    .eq("child_id", childId)
    .eq("attempt_number", 1)
    .not("questions.story_id", "is", null)
    .order("attempted_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return (data ?? []).map((a) => {
    const q = one(a.questions as unknown as { story_id: string | null; skills: unknown } | null);
    const skill = one(
      q?.skills as { reading_skill_code: string | null } | { reading_skill_code: string | null }[] | null,
    );
    return {
      storyId: q?.story_id ?? null,
      readingSkillCode: skill?.reading_skill_code ?? null,
      isCorrect: a.is_correct,
      attemptedAt: a.attempted_at,
    };
  });
}

export async function loadReadingHome(childId: string, levelId: string | null) {
  const supabase = await createClient();
  const [stories, lessons, sessions, attempts, reviews, rules] = await Promise.all([
    supabase.from("stories").select(STORY_LIST_COLUMNS).eq("status", "published").limit(500),
    readingLessons(supabase),
    supabase
      .from("reading_sessions")
      .select("story_id, started_at")
      .eq("child_id", childId)
      .order("started_at", { ascending: false })
      .limit(1000),
    comprehensionAttempts(supabase, childId),
    supabase
      .from("review_items")
      .select("word_id, priority, words(word, emoji)")
      .eq("child_id", childId)
      .eq("status", "open")
      .like("item_key", "reading:%")
      .order("priority", { ascending: false })
      .limit(12),
    loadLearningRules(supabase),
  ]);
  for (const r of [stories, sessions, reviews]) if (r.error) throw r.error;

  const items = ((stories.data ?? []) as unknown as StoryListRow[])
    .map((row) => toLibraryItem(row, lessons.get(row.code) ?? null))
    .sort(byLibraryOrder);
  const lessonIds = items.map((i) => i.lessonId).filter((id): id is string => !!id);
  const { data: progress, error: progressError } = lessonIds.length
    ? await supabase
        .from("lesson_progress")
        .select("lesson_id, best_stars")
        .eq("child_id", childId)
        .in("lesson_id", lessonIds)
    : { data: [], error: null };
  if (progressError) throw progressError;
  const stars = new Map((progress ?? []).map((p) => [p.lesson_id, p.best_stars]));
  const readCount = new Map<string, number>();
  for (const s of sessions.data ?? []) readCount.set(s.story_id, (readCount.get(s.story_id) ?? 0) + 1);
  const comprehension = comprehensionByStory(attempts);
  for (const item of items) {
    item.readings = readCount.get(item.storyId) ?? 0;
    item.stars = item.lessonId ? (stars.get(item.lessonId) ?? 0) : 0;
    item.comprehension = comprehension.get(item.storyId) ?? null;
  }
  const level = items.find((i) => i.levelId === levelId);
  const levelRank = level?.levelRank ?? items[0]?.levelRank ?? 1;
  const read = new Set(items.filter((i) => i.readings > 0 || i.stars > 0).map((i) => i.storyId));
  const recommended = recommendReading({
    texts: items.map((i) => ({
      id: i.storyId,
      levelRank: i.levelRank,
      readingLevel: i.readingLevel,
      difficulty: i.difficulty,
      lessonId: i.lessonId,
    })),
    levelRank,
    readStoryIds: read,
    comprehension,
    rules: rules.reading,
  }).map((r) => ({ ...r, item: items.find((i) => i.storyId === r.storyId)! }));

  return {
    levelRank,
    items,
    recommended,
    helpWords: (reviews.data ?? []).map((r) => {
      const w = one(r.words as { word: string; emoji: string } | { word: string; emoji: string }[] | null);
      return { wordId: r.word_id!, word: w?.word ?? "", emoji: w?.emoji ?? "" };
    }),
  };
}

// Word ids of the open "tapped for help while reading" review items, most urgent first.
export async function readingWordsToPractise(childId: string, limit: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("review_items")
    .select("word_id")
    .eq("child_id", childId)
    .eq("status", "open")
    .like("item_key", "reading:%")
    .order("priority", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => r.word_id).filter((id): id is string => !!id);
}

// ---------------------------------------------------------------------------------------
// The parent's reading report: lessons, skills learning/mastered, comprehension by reading
// skill, difficult words, recent reading and what to read next. From stored history only;
// no reading speed or pronunciation figure (none is measured).

export async function loadReadingReport(childId: string, levelId: string | null) {
  const supabase = await createClient();
  const home = await loadReadingHome(childId, levelId);
  const [sessions, attempts, skills, mastery, skillTypes, rules] = await Promise.all([
    supabase
      .from("reading_sessions")
      .select(
        "id, story_id, mode, started_at, duration_ms, word_count, listens, slow_listens, rereads, help_word_ids, self_check",
      )
      .eq("child_id", childId)
      .order("started_at", { ascending: false })
      .limit(500),
    comprehensionAttempts(supabase, childId),
    supabase
      .from("skills")
      .select("id, title, child_title, reading_skill_code")
      .not("reading_skill_code", "is", null),
    supabase.from("skill_mastery").select("skill_id, status, mastery_score").eq("child_id", childId),
    supabase.from("reading_skill_types").select("code, name, strand, sort_order").order("sort_order"),
    loadLearningRules(supabase),
  ]);
  for (const r of [sessions, skills, mastery, skillTypes]) if (r.error) throw r.error;

  const sessionRows = sessions.data ?? [];
  const summary = summarizeReadingSessions(
    sessionRows.map((s) => ({
      storyId: s.story_id,
      startedAt: s.started_at,
      durationMs: s.duration_ms,
      wordCount: s.word_count,
      listens: s.listens,
      slowListens: s.slow_listens,
      rereads: s.rereads,
      helpWordIds: s.help_word_ids ?? [],
      selfCheck: s.self_check as "easy" | "ok" | "hard" | null,
    })),
    rules.reading,
  );
  const helpIds = summary.helpWords.slice(0, 12).map((h) => h.wordId);
  const { data: helpWords, error: helpError } = helpIds.length
    ? await supabase.from("words").select("id, word, emoji").in("id", helpIds)
    : { data: [], error: null };
  if (helpError) throw helpError;
  const wordById = new Map((helpWords ?? []).map((w) => [w.id, w]));

  // Skill mastery per reading skill (the ordinary skill_mastery rows of tagged skills).
  const statusBySkill = new Map((mastery.data ?? []).map((m) => [m.skill_id, m.status as MasteryStatus]));
  const skillsByCode = new Map<string, MasteryStatus[]>();
  for (const s of skills.data ?? []) {
    const list = skillsByCode.get(s.reading_skill_code!) ?? [];
    list.push(statusBySkill.get(s.id) ?? "NOT_STARTED");
    skillsByCode.set(s.reading_skill_code!, list);
  }
  const byCode = new Map(comprehensionBySkill(attempts).map((c) => [c.code, c]));
  const skillRows = (skillTypes.data ?? [])
    .filter((t) => skillsByCode.has(t.code) || byCode.has(t.code))
    .map((t) => {
      const statuses = skillsByCode.get(t.code) ?? [];
      return {
        code: t.code,
        name: t.name,
        strand: t.strand,
        status: bestStatus(statuses),
        comprehension: byCode.get(t.code) ?? null,
      };
    });
  const storyById = new Map(home.items.map((i) => [i.storyId, i]));
  const firstTries = attempts.length;
  const correct = attempts.filter((a) => a.isCorrect).length;

  return {
    summary,
    lessonsCompleted: home.items.filter((i) => i.stars > 0).length,
    textsAvailable: home.items.filter((i) => i.lessonId).length,
    comprehension: {
      firstTries,
      correct,
      percent: firstTries ? Math.round((correct / firstTries) * 100) : null,
    },
    skills: skillRows,
    learning: skillRows.filter((s) => s.status !== "NOT_STARTED" && s.status !== "MASTERED").length,
    mastered: skillRows.filter((s) => s.status === "MASTERED").length,
    helpWords: summary.helpWords
      .slice(0, 12)
      .map((h) => ({
        ...h,
        word: wordById.get(h.wordId)?.word ?? "",
        emoji: wordById.get(h.wordId)?.emoji ?? "",
      }))
      .filter((h) => h.word),
    recent: sessionRows.slice(0, 10).map((s) => ({
      id: s.id,
      title: storyById.get(s.story_id)?.title ?? "",
      emoji: storyById.get(s.story_id)?.emoji ?? "",
      mode: s.mode,
      startedAt: s.started_at,
      seconds: Math.round(Math.min(s.duration_ms, rules.reading.maxCountedSeconds * 1000) / 1000),
      rereads: s.rereads,
      listens: s.listens + s.slow_listens,
      helpTaps: (s.help_word_ids ?? []).length,
      selfCheck: s.self_check,
    })),
    recommended: home.recommended,
  };
}

const STATUS_ORDER: MasteryStatus[] = [
  "NOT_STARTED",
  "LEARNING",
  "PRACTICING",
  "ALMOST_MASTERED",
  "MASTERED",
];
function bestStatus(statuses: MasteryStatus[]): MasteryStatus {
  return statuses.reduce<MasteryStatus>(
    (best, s) => (STATUS_ORDER.indexOf(s) > STATUS_ORDER.indexOf(best) ? s : best),
    "NOT_STARTED",
  );
}

// ---------------------------------------------------------------------------------------
// Admin: every story (drafts too — admins see everything through RLS), with its analysis.

export async function loadAdminStories() {
  const supabase = await createClient();
  const [stories, lessons, flags] = await Promise.all([
    supabase
      .from("stories")
      .select(`${STORY_LIST_COLUMNS}, status, decodable_pct, unknown_words, text_stats`)
      .order("code")
      .limit(1000),
    readingLessons(supabase),
    supabase.from("content_flags").select("entity_key, rule, severity, message").eq("entity", "story"),
  ]);
  if (stories.error) throw stories.error;
  if (flags.error) throw flags.error;
  return (
    (stories.data ?? []) as unknown as (StoryListRow & {
      status: string;
      decodable_pct: number | null;
      unknown_words: string[];
      text_stats: Record<string, number>;
    })[]
  )
    .map((row) => ({
      ...toLibraryItem(row, lessons.get(row.code) ?? null),
      status: row.status,
      decodablePct: row.decodable_pct === null ? null : Number(row.decodable_pct),
      unknownWords: row.unknown_words ?? [],
      stats: row.text_stats ?? {},
      flags: (flags.data ?? []).filter((f) => f.entity_key === row.code),
    }))
    .sort(byLibraryOrder);
}

export async function loadAdminStory(code: string) {
  if (!/^[a-z0-9-]{2,80}$/.test(code)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stories")
    .select(
      `${PASSAGE_COLUMNS}, status, summary, level_id, levels(code, name), difficulty, reading_level, genre, topic, tags, decodable_pct, unknown_words, text_stats, story_phonics_patterns(phonics_patterns(code, pattern)), story_reading_skills(reading_skill_code)`,
    )
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as PassageRow & {
    status: string;
    summary: string;
    levels: { code: string; name: string } | { code: string; name: string }[] | null;
    difficulty: number;
    reading_level: number | null;
    genre: string;
    topic: string;
    tags: string[];
    decodable_pct: number | null;
    unknown_words: string[];
    text_stats: Record<string, number>;
    story_phonics_patterns: { phonics_patterns: { code: string; pattern: string } | null }[] | null;
    story_reading_skills: { reading_skill_code: string }[] | null;
  };
  const [{ data: links }, { data: questions }, lessons] = await Promise.all([
    supabase
      .from("story_words")
      .select("occurrences, is_decodable, is_sight, is_irregular, is_target_pattern, is_focus, words(word)")
      .eq("story_id", row.id),
    supabase
      .from("questions")
      .select("id, code, question_type, prompt, status, skills(code, reading_skill_code)")
      .eq("story_id", row.id)
      .order("code"),
    readingLessons(supabase),
  ]);
  return {
    passage: toPassage(row),
    status: row.status,
    summary: row.summary,
    level: one(row.levels),
    difficulty: row.difficulty,
    readingLevel: row.reading_level,
    genre: row.genre,
    topic: row.topic,
    tags: row.tags,
    decodablePct: row.decodable_pct === null ? null : Number(row.decodable_pct),
    unknownWords: row.unknown_words ?? [],
    stats: row.text_stats ?? {},
    patterns: (row.story_phonics_patterns ?? []).map((p) => p.phonics_patterns).filter(Boolean),
    skills: (row.story_reading_skills ?? []).map((s) => s.reading_skill_code),
    lessonId: lessons.get(row.code) ?? null,
    words: (links ?? []).map((l) => ({
      word: one(l.words as { word: string } | { word: string }[] | null)?.word ?? "",
      occurrences: l.occurrences,
      decodable: l.is_decodable,
      sight: l.is_sight,
      irregular: l.is_irregular,
      target: l.is_target_pattern,
      focus: l.is_focus,
    })),
    questions: (questions ?? []).map((q) => {
      const skill = one(
        q.skills as
          | { code: string; reading_skill_code: string | null }
          | { code: string; reading_skill_code: string | null }[]
          | null,
      );
      return {
        id: q.id,
        code: q.code,
        type: q.question_type,
        prompt: q.prompt,
        status: q.status,
        readingSkill: skill?.reading_skill_code ?? null,
      };
    }),
  };
}
