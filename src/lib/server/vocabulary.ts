import "server-only";

import { publicAudioUrl, publicImageUrl } from "@/lib/content/media";
import { soundToken } from "@/lib/audio/pronunciation";
import { getPublicEnv } from "@/lib/env";
import type { MasteryStatus } from "@/lib/learning/mastery";
import {
  isWordArea,
  summarizeVocabulary,
  wordAreaFor,
  WORD_AREAS,
  type VocabularyAreaFact,
  type VocabularyWordFact,
  type WordArea,
} from "@/lib/learning/vocabulary";
import { createClient } from "@/lib/supabase/server";
import type { WordSearch } from "@/lib/validation/vocabulary";

// Vocabulary data for the child's Words screens, the parent's progress page and the word
// search. Everything is read with the signed-in user's RLS client: published content only
// (admins also see drafts) and progress only for the parent's own children. Lists are
// filtered and paginated in the database — the word bank never goes to the browser whole.

type Supabase = Awaited<ReturnType<typeof createClient>>;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

const NO_MATCH = "00000000-0000-0000-0000-000000000000";
export const WORD_PAGE_SIZE = 24;

function supabaseUrl() {
  try {
    return getPublicEnv().NEXT_PUBLIC_SUPABASE_URL;
  } catch {
    return null;
  }
}

function imageFor(asset: { storage_path: string; alt_text: string; status: string } | null) {
  const base = supabaseUrl();
  if (!asset || asset.status !== "published" || !base) return null;
  return { url: publicImageUrl(base, asset.storage_path), alt: asset.alt_text };
}

// ---------------------------------------------------------------------------------------
// Categories

export type CategoryNode = {
  id: string;
  code: string;
  name: string;
  emoji: string;
  description: string;
  parentId: string | null;
};

export async function loadCategories(supabase?: Supabase) {
  const db = supabase ?? (await createClient());
  const { data, error } = await db
    .from("word_categories")
    .select("id, code, name, emoji, description, parent_id, sort_order")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((c): CategoryNode => ({
    id: c.id,
    code: c.code,
    name: c.name,
    emoji: c.emoji,
    description: c.description,
    parentId: c.parent_id,
  }));
}

// A category and its sub-categories (searching "Animals" finds farm animals too).
function categoryIdsFor(code: string, categories: CategoryNode[]) {
  const root = categories.find((c) => c.code === code);
  if (!root) return [NO_MATCH];
  return [root.id, ...categories.filter((c) => c.parentId === root.id).map((c) => c.id)];
}

function rootOf(categoryId: string | null, categories: CategoryNode[]) {
  const c = categories.find((x) => x.id === categoryId);
  if (!c) return null;
  return c.parentId ? (categories.find((x) => x.id === c.parentId) ?? c) : c;
}

// ---------------------------------------------------------------------------------------
// Search

export type WordListItem = {
  id: string;
  word: string;
  emoji: string;
  image: { url: string; alt: string } | null;
  level: string;
  category: string | null;
  categoryEmoji: string;
  partOfSpeech: string;
  difficulty: number;
  shape: string | null;
  status: string;
};

// Search by the start of the word, category (with sub-categories), level (any level the
// word suits), difficulty, phonics pattern (words whose split uses it: "which words
// practise SH?"), part of speech and phonics shape (CVC…). Pages of `pageSize`.
export async function searchWords(search: WordSearch, options: { pageSize?: number } = {}) {
  const supabase = await createClient();
  const pageSize = options.pageSize ?? WORD_PAGE_SIZE;
  const page = Math.max(1, search.page ?? 1);
  const categories = await loadCategories(supabase);

  const joins = [
    search.level ? "word_levels!inner(level_id)" : "",
    search.pattern ? "word_segments!inner(pattern_id)" : "",
  ].filter(Boolean);
  let query = supabase
    .from("words")
    .select(
      [
        "id, word, emoji, difficulty, part_of_speech, phonics_shape, status, category_id",
        "levels!words_level_id_fkey(code, short_name)",
        "image_assets(storage_path, alt_text, status)",
        ...joins,
      ].join(", "),
      { count: "exact" },
    )
    .eq("sense", 1)
    .order("normalized_word")
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (search.q) query = query.ilike("normalized_word", `${search.q.replace(/[%_\\]/g, "")}%`);
  if (search.category) query = query.in("category_id", categoryIdsFor(search.category, categories));
  if (search.pos) query = query.eq("part_of_speech", search.pos);
  if (search.shape) query = query.eq("phonics_shape", search.shape);
  if (search.difficulty) query = query.eq("difficulty", search.difficulty);
  if (search.level) {
    const { data: level } = await supabase.from("levels").select("id").eq("code", search.level).maybeSingle();
    query = query.eq("word_levels.level_id", level?.id ?? NO_MATCH);
  }
  if (search.pattern) {
    const { data: pattern } = await supabase
      .from("phonics_patterns")
      .select("id")
      .eq("code", search.pattern)
      .maybeSingle();
    query = query.eq("word_segments.pattern_id", pattern?.id ?? NO_MATCH);
  }
  const { data, error, count } = await query;
  if (error) throw error;
  type Row = {
    id: string;
    word: string;
    emoji: string;
    difficulty: number;
    part_of_speech: string;
    phonics_shape: string | null;
    status: string;
    category_id: string | null;
    levels: { code: string; short_name: string } | { code: string; short_name: string }[] | null;
    image_assets: { storage_path: string; alt_text: string; status: string } | null;
  };
  const words = ((data ?? []) as unknown as Row[]).map((w): WordListItem => {
    const category = categories.find((c) => c.id === w.category_id) ?? null;
    return {
      id: w.id,
      word: w.word,
      emoji: w.emoji,
      image: imageFor(one(w.image_assets)),
      level: one(w.levels)?.short_name ?? "",
      category: category?.name ?? null,
      categoryEmoji: category?.emoji ?? "",
      partOfSpeech: w.part_of_speech,
      difficulty: w.difficulty,
      shape: w.phonics_shape,
      status: w.status,
    };
  });
  return {
    page,
    total: count ?? 0,
    pages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
    words,
  };
}

// Choices for the search filters, from the database.
export async function loadWordFilters() {
  const supabase = await createClient();
  const [categories, levels, patterns] = await Promise.all([
    loadCategories(supabase),
    supabase.from("levels").select("code, name").eq("status", "published").order("sort_order"),
    supabase.from("phonics_patterns").select("code, pattern, pattern_type").order("sort_order"),
  ]);
  for (const r of [levels, patterns]) if (r.error) throw r.error;
  return {
    categories: categories.filter((c) => !c.parentId),
    levels: levels.data ?? [],
    patterns: (patterns.data ?? []).map((p) => ({
      code: p.code,
      label: `${p.pattern.replace("_", "–")} (${p.pattern_type.replace(/_/g, " ")})`,
    })),
  };
}

// ---------------------------------------------------------------------------------------
// Word Explorer

export async function loadWordDetail(wordId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(wordId)) return null;
  const supabase = await createClient();
  const { data: w, error } = await supabase
    .from("words")
    .select(
      "id, word, emoji, definition, child_definition, part_of_speech, pronunciation, tts_text, syllable_count, difficulty, is_sight_word, is_irregular, spelling_note, plural, inflections, phonics_shape, decodable, category_id, status, levels!words_level_id_fkey(code, name, short_name), image_assets(storage_path, alt_text, status), audio_assets(storage_path, status)",
    )
    .eq("id", wordId)
    .maybeSingle();
  if (error) throw error;
  if (!w) return null;

  const [categories, levels, segments, sentences, relations, families, patterns, questions] =
    await Promise.all([
      loadCategories(supabase),
      supabase
        .from("word_levels")
        .select("is_primary, levels(code, short_name, sort_order)")
        .eq("word_id", wordId),
      supabase
        .from("word_segments")
        .select(
          "position, grapheme, phonemes, phonics_patterns(code, pattern_type), phonics_pattern_sounds(say_as, label)",
        )
        .eq("word_id", wordId)
        .order("position"),
      supabase
        .from("word_sentences")
        .select("sort_order, sentences(text, emoji, status)")
        .eq("word_id", wordId)
        .order("sort_order"),
      supabase
        .from("word_relations")
        .select("relation_type, words!word_relations_related_word_id_fkey(id, word, emoji, status)")
        .eq("word_id", wordId),
      supabase
        .from("word_family_members")
        .select(
          "word_families(id, code, rime, title, emoji, word_family_members(sort_order, words(id, word, emoji)))",
        )
        .eq("word_id", wordId),
      supabase
        .from("word_phonics_patterns")
        .select("phonics_patterns(code, pattern, pattern_type)")
        .eq("word_id", wordId),
      supabase
        .from("questions")
        .select("question_type, metadata")
        .eq("word_id", wordId)
        .eq("status", "published")
        .neq("question_type", "INTRO"),
    ]);
  for (const r of [levels, segments, sentences, relations, families, patterns, questions])
    if (r.error) throw r.error;

  // Sounds for the phonics strip: the pattern sound's say-as, else the phonemes'.
  const phonemeCodes = [...new Set((segments.data ?? []).flatMap((s) => s.phonemes ?? []))];
  const { data: phonemes } = phonemeCodes.length
    ? await supabase.from("phonemes").select("code, say_as, label").in("code", phonemeCodes)
    : { data: [] as { code: string; say_as: string; label: string }[] };
  const phonemeSay = new Map((phonemes ?? []).map((p) => [p.code, p]));

  const category = categories.find((c) => c.id === w.category_id) ?? null;
  const root = rootOf(w.category_id, categories);
  const base = supabaseUrl();
  const audio = one(w.audio_assets);
  const areas = new Set<WordArea>();
  for (const q of questions.data ?? []) {
    const area = wordAreaFor(q.question_type, q.metadata);
    if (area) areas.add(area);
  }
  const relationList = (relations.data ?? []).flatMap((r) => {
    const other = one(r.words);
    return other && other.status === "published"
      ? [{ type: r.relation_type, id: other.id, word: other.word, emoji: other.emoji }]
      : [];
  });

  return {
    id: w.id,
    word: w.word,
    emoji: w.emoji,
    image: imageFor(one(w.image_assets)),
    audioUrl:
      audio && audio.status === "published" && audio.storage_path && base
        ? publicAudioUrl(base, audio.storage_path)
        : null,
    speech: w.tts_text || w.word,
    meaning: w.child_definition || w.definition,
    definition: w.definition,
    partOfSpeech: w.part_of_speech,
    pronunciation: w.pronunciation,
    syllables: w.syllable_count,
    difficulty: w.difficulty,
    irregular: w.is_irregular ? w.spelling_note : null,
    plural: w.plural,
    inflections: (w.inflections ?? {}) as Record<string, string>,
    shape: w.phonics_shape,
    decodable: w.decodable,
    level: one(w.levels),
    levels: (levels.data ?? [])
      .map((l) => ({ ...one(l.levels)!, primary: l.is_primary }))
      .filter((l) => l.code)
      .sort((a, b) => a.sort_order - b.sort_order),
    category: category ? { code: category.code, name: category.name, emoji: category.emoji } : null,
    topCategory:
      root && root.id !== category?.id ? { code: root.code, name: root.name, emoji: root.emoji } : null,
    segments: (segments.data ?? []).map((s) => {
      const sound = one(s.phonics_pattern_sounds);
      const codes = s.phonemes ?? [];
      return {
        grapheme: s.grapheme,
        silent: codes.length === 0,
        // The sound token ({/SH/}), resolved by the audio service: never the letters.
        sayAs: soundToken(codes),
        label: sound?.label || codes.map((c) => phonemeSay.get(c)?.label ?? c.toLowerCase()).join(""),
        patternType: one(s.phonics_patterns)?.pattern_type ?? null,
      };
    }),
    examples: (sentences.data ?? []).flatMap((s) => {
      const sentence = one(s.sentences);
      return sentence && sentence.status === "published"
        ? [{ text: sentence.text, emoji: sentence.emoji }]
        : [];
    }),
    synonyms: relationList.filter((r) => r.type === "synonym"),
    antonyms: relationList.filter((r) => r.type === "antonym"),
    related: relationList.filter((r) => !["synonym", "antonym"].includes(r.type)),
    families: (families.data ?? []).flatMap((f) => {
      const family = one(f.word_families);
      if (!family) return [];
      return [
        {
          code: family.code,
          rime: family.rime,
          title: family.title,
          emoji: family.emoji,
          words: [...(family.word_family_members ?? [])]
            .sort((a, b) => a.sort_order - b.sort_order)
            .flatMap((m) => {
              const word = one(m.words);
              return word && word.id !== wordId ? [word] : [];
            })
            .slice(0, 8),
        },
      ];
    }),
    patterns: (patterns.data ?? []).flatMap((p) => {
      const pattern = one(p.phonics_patterns);
      return pattern
        ? [{ code: pattern.code, pattern: pattern.pattern.replace("_", "–"), type: pattern.pattern_type }]
        : [];
    }),
    practiceAreas: WORD_AREAS.filter((a) => areas.has(a)),
  };
}
export type WordDetail = NonNullable<Awaited<ReturnType<typeof loadWordDetail>>>;

// One child's progress on one word (RLS: the parent's own child only).
export async function loadChildWord(childId: string, wordId: string) {
  const supabase = await createClient();
  const [progress, areas] = await Promise.all([
    supabase
      .from("word_progress")
      .select(
        "is_saved, status, mastery_score, accuracy, attempts_count, correct_count, first_seen_at, last_practiced_at",
      )
      .eq("child_id", childId)
      .eq("word_id", wordId)
      .maybeSingle(),
    supabase
      .from("word_area_progress")
      .select("area, attempts_count, accuracy")
      .eq("child_id", childId)
      .eq("word_id", wordId),
  ]);
  if (progress.error) throw progress.error;
  if (areas.error) throw areas.error;
  return {
    saved: progress.data?.is_saved ?? false,
    status: (progress.data?.status ?? "NOT_STARTED") as MasteryStatus,
    accuracy: Number(progress.data?.accuracy ?? 0),
    attempts: progress.data?.attempts_count ?? 0,
    areas: (areas.data ?? []).flatMap((a) =>
      isWordArea(a.area) ? [{ area: a.area, attempts: a.attempts_count, accuracy: Number(a.accuracy) }] : [],
    ),
  };
}

// ---------------------------------------------------------------------------------------
// The child's vocabulary home

export async function loadVocabularyHome(childId: string, levelId: string | null) {
  const supabase = await createClient();
  const [categories, counts, progress, review] = await Promise.all([
    loadCategories(supabase),
    supabase.from("word_category_stats").select("category_id, published_words"),
    supabase
      .from("word_progress")
      .select("word_id, is_saved, status, words(category_id)")
      .eq("child_id", childId),
    supabase
      .from("review_items")
      .select("word_id", { count: "exact", head: true })
      .eq("child_id", childId)
      .eq("status", "open")
      .not("word_id", "is", null)
      .lte("due_at", new Date().toISOString()),
  ]);
  if (counts.error) throw counts.error;
  if (progress.error) throw progress.error;
  const known = new Set((progress.data ?? []).map((p) => p.word_id));

  // New words: at the child's level, with a picture, not met yet.
  let newWords: { id: string; word: string; emoji: string }[] = [];
  if (levelId) {
    const { data, error } = await supabase
      .from("words")
      .select("id, word, emoji, difficulty, word_levels!inner(level_id)")
      .eq("word_levels.level_id", levelId)
      .eq("sense", 1)
      .neq("emoji", "")
      .neq("category_id", categories.find((c) => c.code === "FUNCTION_WORDS")?.id ?? NO_MATCH)
      .order("difficulty")
      .order("normalized_word")
      .limit(60);
    if (error) throw error;
    newWords = (data ?? []).filter((w) => !known.has(w.id)).slice(0, 8);
  }

  const totals = new Map<string, number>();
  for (const c of counts.data ?? []) {
    const root = rootOf(c.category_id, categories);
    if (root) totals.set(root.id, (totals.get(root.id) ?? 0) + (c.published_words ?? 0));
  }
  const learned = new Map<string, number>();
  for (const p of progress.data ?? []) {
    if (p.status === "NOT_STARTED") continue;
    const root = rootOf(one(p.words)?.category_id ?? null, categories);
    if (root) learned.set(root.id, (learned.get(root.id) ?? 0) + 1);
  }
  return {
    myWords: (progress.data ?? []).filter((p) => p.is_saved).length,
    mastered: (progress.data ?? []).filter((p) => p.status === "MASTERED").length,
    dueReviews: review.count ?? 0,
    newWords,
    categories: categories
      .filter((c) => !c.parentId && c.code !== "FUNCTION_WORDS" && (totals.get(c.id) ?? 0) > 0)
      .map((c) => ({ ...c, total: totals.get(c.id) ?? 0, started: learned.get(c.id) ?? 0 })),
  };
}

// Words of one category (and its sub-categories), a page at a time, with the child's
// progress on each.
export async function loadCategoryWords(childId: string, code: string, page: number) {
  const supabase = await createClient();
  const categories = await loadCategories(supabase);
  const category = categories.find((c) => c.code === code && !c.parentId);
  if (!category) return null;
  const result = await searchWords({ category: code, page }, { pageSize: WORD_PAGE_SIZE });
  const ids = result.words.map((w) => w.id);
  const { data: progress, error } = ids.length
    ? await supabase
        .from("word_progress")
        .select("word_id, status, is_saved")
        .eq("child_id", childId)
        .in("word_id", ids)
    : { data: [], error: null };
  if (error) throw error;
  const byWord = new Map((progress ?? []).map((p) => [p.word_id, p]));
  return {
    category,
    subcategories: categories.filter((c) => c.parentId === category.id),
    ...result,
    words: result.words.map((w) => ({
      ...w,
      status: (byWord.get(w.id)?.status ?? "NOT_STARTED") as MasteryStatus,
      saved: byWord.get(w.id)?.is_saved ?? false,
    })),
  };
}

// My Words: saved words, the most urgent to review first.
export async function loadMyWords(childId: string) {
  const supabase = await createClient();
  const [{ data, error }, { data: due, error: dueError }] = await Promise.all([
    supabase
      .from("word_progress")
      .select(
        "word_id, status, accuracy, attempts_count, review_priority, next_review_at, saved_at, words(id, word, emoji, status)",
      )
      .eq("child_id", childId)
      .eq("is_saved", true)
      .order("review_priority", { ascending: false })
      .limit(200),
    supabase
      .from("review_items")
      .select("word_id, priority")
      .eq("child_id", childId)
      .eq("status", "open")
      .not("word_id", "is", null)
      .lte("due_at", new Date().toISOString())
      .order("priority", { ascending: false })
      .limit(50),
  ]);
  if (error) throw error;
  if (dueError) throw dueError;
  const dueIds = new Set((due ?? []).map((d) => d.word_id));
  return (data ?? [])
    .flatMap((p) => {
      const word = one(p.words);
      if (!word || word.status !== "published") return [];
      return [
        {
          id: word.id,
          word: word.word,
          emoji: word.emoji,
          status: p.status as MasteryStatus,
          accuracy: Number(p.accuracy),
          attempts: p.attempts_count,
          due: dueIds.has(word.id),
          priority: Number(p.review_priority),
        },
      ];
    })
    .sort((a, b) => Number(b.due) - Number(a.due) || b.priority - a.priority);
}

// Words to practise now, most urgent first: due review items, then saved words by priority.
export async function wordsToPractise(childId: string, limit = 6) {
  const words = await loadMyWords(childId);
  return words.slice(0, limit).map((w) => w.id);
}

// ---------------------------------------------------------------------------------------
// Parent report

export async function loadVocabularyReport(childId: string) {
  const supabase = await createClient();
  const [categories, progress, areas] = await Promise.all([
    loadCategories(supabase),
    supabase
      .from("word_progress")
      .select(
        "word_id, status, attempts_count, correct_count, accuracy, is_saved, last_practiced_at, words(word, emoji, category_id)",
      )
      .eq("child_id", childId)
      .limit(5000),
    supabase
      .from("word_area_progress")
      .select("area, attempts_count, correct_count")
      .eq("child_id", childId)
      .limit(20000),
  ]);
  if (progress.error) throw progress.error;
  if (areas.error) throw areas.error;
  const words: VocabularyWordFact[] = (progress.data ?? []).map((p) => {
    const word = one(p.words);
    const root = rootOf(word?.category_id ?? null, categories);
    return {
      wordId: p.word_id,
      word: word?.word ?? "",
      emoji: word?.emoji ?? "",
      categoryCode: root?.code ?? null,
      categoryName: root?.name ?? null,
      status: p.status as MasteryStatus,
      attempts: p.attempts_count,
      correct: p.correct_count,
      accuracy: Number(p.accuracy),
      isSaved: p.is_saved,
      lastPracticedAt: p.last_practiced_at,
    };
  });
  const areaFacts: VocabularyAreaFact[] = (areas.data ?? []).flatMap((a) =>
    isWordArea(a.area) ? [{ area: a.area, attempts: a.attempts_count, correct: a.correct_count }] : [],
  );
  return summarizeVocabulary(words, areaFacts);
}
export type VocabularyReport = Awaited<ReturnType<typeof loadVocabularyReport>>;
