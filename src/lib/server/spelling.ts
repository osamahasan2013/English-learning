import "server-only";

import type { MasteryStatus } from "@/lib/learning/mastery";
import {
  isSpellingErrorType,
  spellingTrend,
  summarizeSpelling,
  type SpellingErrorType,
  type SpellingWordFact,
} from "@/lib/learning/spelling";
import { createClient } from "@/lib/supabase/server";

// Spelling data for the child's Spelling screens and the parent's spelling progress. Read
// with the signed-in user's RLS client: published content only and progress only for the
// parent's own children. Lists are filtered, counted and paginated in the database.

type Supabase = Awaited<ReturnType<typeof createClient>>;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export const SPELLING_PAGE_SIZE = 24;
const SPELLING_REASONS = ["missed_spelling", "weak_spelling", "spelling_pattern"];

// Open review items that belong to spelling: words (spelling:<id>) and patterns misspelled.
async function openSpellingReviews(supabase: Supabase, childId: string, dueOnly: boolean, limit = 50) {
  let query = supabase
    .from("review_items")
    .select("item_key, word_id, phonics_pattern_id, lesson_id, priority, due_at, reason")
    .eq("child_id", childId)
    .eq("status", "open")
    .or(`item_key.like.spelling:*,reason.in.(${SPELLING_REASONS.join(",")})`)
    .order("priority", { ascending: false })
    .limit(limit);
  if (dueOnly) query = query.lte("due_at", new Date().toISOString());
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// Spelling skills and lessons of a level (spelling units of the level path), with the
// child's stars and mastery.
export async function loadSpellingHome(childId: string, levelId: string | null) {
  const supabase = await createClient();
  const catalog = supabase
    .from("lesson_catalog")
    .select(
      "lesson_id, lesson_child_title, lesson_title, lesson_emoji, lesson_order, skill_id, skill_child_title, skill_title, skill_order, unit_order, level_id, level_code, level_name, level_order",
    )
    .eq("subject_code", "SPELLING")
    .eq("skill_active", true)
    .order("level_order")
    .order("unit_order")
    .order("skill_order")
    .order("lesson_order")
    .limit(400);
  const [{ data: lessons, error }, practiced, mastered, due] = await Promise.all([
    catalog,
    supabase
      .from("spelling_progress")
      .select("word_id", { count: "exact", head: true })
      .eq("child_id", childId),
    supabase
      .from("spelling_progress")
      .select("word_id", { count: "exact", head: true })
      .eq("child_id", childId)
      .eq("status", "MASTERED"),
    openSpellingReviews(supabase, childId, true),
  ]);
  if (error) throw error;
  if (practiced.error || mastered.error) throw practiced.error ?? mastered.error;
  const rows = (lessons ?? []).filter((l) => l.lesson_id && l.skill_id && l.level_id);
  const lessonIds = rows.map((l) => l.lesson_id!);
  const skillIds = [...new Set(rows.map((l) => l.skill_id!))];
  const [{ data: progress, error: progressError }, { data: skills, error: skillsError }] = await Promise.all([
    lessonIds.length
      ? supabase
          .from("lesson_progress")
          .select("lesson_id, status, best_stars")
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
  if (progressError || skillsError) throw progressError ?? skillsError;
  const stars = new Map((progress ?? []).map((p) => [p.lesson_id, p.best_stars]));
  const status = new Map((skills ?? []).map((s) => [s.skill_id, s.status as MasteryStatus]));

  type SkillGroup = {
    id: string;
    title: string;
    status: MasteryStatus;
    lessons: { id: string; title: string; emoji: string; stars: number }[];
  };
  const levels = new Map<string, { id: string; code: string; name: string; skills: SkillGroup[] }>();
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
    level: current,
    otherLevels: all.filter((l) => l !== current).map((l) => ({ code: l.code, name: l.name })),
    levels: all,
    wordsPracticed: practiced.count ?? 0,
    wordsMastered: mastered.count ?? 0,
    dueReviews: due.length,
  };
}
export type SpellingHome = Awaited<ReturnType<typeof loadSpellingHome>>;

// The spelling skills of a level (for dictation by level).
export async function spellingSkillIds(levelId: string | null) {
  if (!levelId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lesson_catalog")
    .select("skill_id")
    .eq("subject_code", "SPELLING")
    .eq("level_id", levelId)
    .eq("skill_active", true)
    .limit(200);
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.skill_id).filter((id): id is string => !!id))];
}

// My Spelling Words: words the child has spelled, latest first, with stars, a page at a time.
export async function loadMySpellingWords(childId: string, page = 1) {
  const supabase = await createClient();
  const from = (Math.max(1, page) - 1) * SPELLING_PAGE_SIZE;
  const [{ data, error, count }, due] = await Promise.all([
    supabase
      .from("spelling_progress")
      .select(
        "word_id, status, accuracy, attempts_count, last_error_type, last_practiced_at, words(id, word, emoji, status)",
        {
          count: "exact",
        },
      )
      .eq("child_id", childId)
      .order("last_practiced_at", { ascending: false, nullsFirst: false })
      .range(from, from + SPELLING_PAGE_SIZE - 1),
    openSpellingReviews(supabase, childId, true),
  ]);
  if (error) throw error;
  const dueIds = new Set(due.map((d) => d.word_id).filter(Boolean));
  const words = (data ?? []).flatMap((p) => {
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
      },
    ];
  });
  return { words, total: count ?? words.length, page: Math.max(1, page), pageSize: SPELLING_PAGE_SIZE };
}

// Spelling review: the words and patterns due, with names and where to practise.
export async function loadSpellingReview(childId: string) {
  const supabase = await createClient();
  const items = await openSpellingReviews(supabase, childId, true);
  const wordIds = items.map((i) => i.word_id).filter((id): id is string => !!id);
  const patternIds = items
    .filter((i) => i.reason === "spelling_pattern" && i.phonics_pattern_id)
    .map((i) => i.phonics_pattern_id!);
  const [{ data: words, error }, { data: patterns, error: patternsError }] = await Promise.all([
    wordIds.length
      ? supabase.from("words").select("id, word, emoji").in("id", wordIds)
      : Promise.resolve({ data: [], error: null }),
    patternIds.length
      ? supabase.from("phonics_patterns").select("id, code, pattern, child_explanation").in("id", patternIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (error || patternsError) throw error ?? patternsError;
  const wordById = new Map((words ?? []).map((w) => [w.id, w]));
  const patternById = new Map((patterns ?? []).map((p) => [p.id, p]));
  return {
    words: items.flatMap((i) => {
      const w = i.word_id ? wordById.get(i.word_id) : undefined;
      return w ? [{ id: w.id, word: w.word, emoji: w.emoji, reason: i.reason }] : [];
    }),
    patterns: items.flatMap((i) => {
      const p =
        i.phonics_pattern_id && i.reason === "spelling_pattern"
          ? patternById.get(i.phonics_pattern_id)
          : undefined;
      return p
        ? [
            {
              id: p.id,
              code: p.code,
              pattern: p.pattern,
              explanation: p.child_explanation,
              lessonId: i.lesson_id,
              // Words that practise this pattern can be spelled again (this, that, three…).
              practiceHref: `/child/spelling/practice?pattern=${p.id}`,
            },
          ]
        : [];
    }),
  };
}

// Words to practise spelling now, most urgent first: due spelling reviews, then words not
// yet mastered by review priority, then new spelling targets of the child's level.
export async function spellingWordsToPractise(childId: string, levelId: string | null, limit = 6) {
  const supabase = await createClient();
  const [due, { data: practising, error }] = await Promise.all([
    openSpellingReviews(supabase, childId, true, limit),
    supabase
      .from("spelling_progress")
      .select("word_id")
      .eq("child_id", childId)
      .neq("status", "MASTERED")
      .order("review_priority", { ascending: false })
      .limit(limit),
  ]);
  if (error) throw error;
  const ids: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id && !ids.includes(id) && ids.length < limit) ids.push(id);
  };
  for (const d of due) add(d.word_id);
  for (const p of practising ?? []) add(p.word_id);
  if (ids.length < limit && levelId) {
    const { data: fresh, error: freshError } = await supabase
      .from("spelling_words")
      .select("word_id, sort_order")
      .eq("level_id", levelId)
      .eq("status", "published")
      .order("sort_order")
      .limit(60);
    if (freshError) throw freshError;
    const { data: done } = await supabase
      .from("spelling_progress")
      .select("word_id")
      .eq("child_id", childId)
      .in(
        "word_id",
        (fresh ?? []).map((f) => f.word_id),
      );
    const seen = new Set((done ?? []).map((d) => d.word_id));
    for (const f of fresh ?? []) if (!seen.has(f.word_id)) add(f.word_id);
  }
  return ids;
}

// ---------------------------------------------------------------------------------------
// Parent report

export const RECENT_ATTEMPTS_PAGE_SIZE = 15;

export async function loadSpellingReport(childId: string, page = 1) {
  const supabase = await createClient();
  const from = (Math.max(1, page) - 1) * RECENT_ATTEMPTS_PAGE_SIZE;
  const since = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
  const [progress, errors, patternErrors, recent, reviews, trendRows] = await Promise.all([
    supabase
      .from("spelling_progress")
      .select(
        "word_id, status, attempts_count, correct_count, hinted_count, accuracy, last_error_type, last_practiced_at, words(word, emoji, spelling_words(spelling_type_code), word_family_members(word_families(code, rime)))",
      )
      .eq("child_id", childId)
      .limit(2000),
    supabase.from("spelling_error_counts").select("error_type, attempts").eq("child_id", childId),
    supabase
      .from("spelling_pattern_errors")
      .select("error_pattern_id, attempts, last_attempt_at")
      .eq("child_id", childId)
      .order("attempts", { ascending: false })
      .limit(10),
    supabase
      .from("activity_attempts")
      .select(
        "id, response, is_correct, error_type, hints_used, attempted_at, attempt_number, word_id, spelling_analysis, words(word, emoji), questions(question_type)",
        {
          count: "exact",
        },
      )
      .eq("child_id", childId)
      .not("spelling_analysis", "is", null)
      .order("attempted_at", { ascending: false })
      .range(from, from + RECENT_ATTEMPTS_PAGE_SIZE - 1),
    openSpellingReviews(supabase, childId, false, 100),
    supabase
      .from("activity_attempts")
      .select("is_correct, response_time_ms, attempted_at")
      .eq("child_id", childId)
      .eq("attempt_number", 1)
      .not("spelling_analysis", "is", null)
      .gte("attempted_at", since)
      .order("attempted_at", { ascending: false })
      .limit(2000),
  ]);
  for (const r of [progress, errors, patternErrors, recent, trendRows]) if (r.error) throw r.error;

  const words: SpellingWordFact[] = (progress.data ?? []).map((p) => {
    const word = one(p.words);
    const spelling = one(word?.spelling_words);
    return {
      wordId: p.word_id,
      word: word?.word ?? "",
      emoji: word?.emoji ?? "",
      spellingType: spelling?.spelling_type_code ?? "OTHER",
      status: p.status as MasteryStatus,
      attempts: p.attempts_count,
      correct: p.correct_count,
      hinted: p.hinted_count,
      accuracy: Number(p.accuracy),
      lastErrorType: p.last_error_type,
      lastPracticedAt: p.last_practiced_at,
      familyCodes: (word?.word_family_members ?? []).flatMap((m) => {
        const family = one(m.word_families);
        return family ? [`-${family.rime}`] : [];
      }),
    };
  });
  const summary = summarizeSpelling(
    words,
    (errors.data ?? []).map((e) => ({ errorType: e.error_type ?? "", attempts: e.attempts ?? 0 })),
  );

  const patternIds = (patternErrors.data ?? [])
    .map((p) => p.error_pattern_id)
    .filter((id): id is string => !!id);
  const { data: patternRows, error: patternRowsError } = patternIds.length
    ? await supabase.from("phonics_patterns").select("id, code, pattern").in("id", patternIds)
    : { data: [], error: null };
  if (patternRowsError) throw patternRowsError;
  const patternById = new Map((patternRows ?? []).map((p) => [p.id, p]));
  const patterns = (patternErrors.data ?? []).flatMap((p) => {
    const row = p.error_pattern_id ? patternById.get(p.error_pattern_id) : undefined;
    return row
      ? [{ code: row.code, pattern: row.pattern, attempts: p.attempts ?? 0, lastAt: p.last_attempt_at }]
      : [];
  });
  // Words to practise now: missed or weak (not merely scheduled for a later review).
  const reviewWordIds = new Set(
    reviews
      .filter((r) => r.reason === "missed_spelling" || r.reason === "weak_spelling")
      .map((r) => r.word_id),
  );
  const { data: typeRows, error: typeError } = await supabase.from("spelling_types").select("code, name");
  if (typeError) throw typeError;
  const typeNames = new Map((typeRows ?? []).map((t) => [t.code, t.name]));

  const trend = spellingTrend(
    (trendRows.data ?? []).map((a) => ({
      isCorrect: a.is_correct,
      responseTimeMs: a.response_time_ms,
      attemptedAt: a.attempted_at,
    })),
    new Date(),
  );
  return {
    ...summary,
    trend,
    types: summary.types.map((t) => ({ ...t, name: typeNames.get(t.code) ?? t.code })),
    patterns,
    toReview: words.filter((w) => reviewWordIds.has(w.wordId)).slice(0, 12),
    recentAttempts: {
      page: Math.max(1, page),
      pageSize: RECENT_ATTEMPTS_PAGE_SIZE,
      total: recent.count ?? 0,
      rows: (recent.data ?? []).map((a) => {
        const word = one(a.words);
        const response = a.response as { value?: unknown; sequence?: unknown };
        const analysis = a.spelling_analysis as { kind?: string; normalized?: string } | null;
        const questionType = one(a.questions)?.question_type ?? "";
        // Typed answers exactly as typed; a chosen missing part or built tiles as the word made.
        const written =
          questionType === "MISSING_LETTER" && analysis?.kind === "word" && analysis.normalized
            ? analysis.normalized
            : typeof response.value === "string"
              ? response.value
              : Array.isArray(response.sequence)
                ? response.sequence.join("")
                : "";
        return {
          id: a.id,
          word: word?.word ?? null,
          emoji: word?.emoji ?? "",
          written,
          correct: a.is_correct,
          errorType: isSpellingErrorType(a.error_type) ? (a.error_type as SpellingErrorType) : null,
          hintsUsed: a.hints_used,
          tryNumber: a.attempt_number,
          at: a.attempted_at,
          questionType,
        };
      }),
    },
  };
}
export type SpellingReport = Awaited<ReturnType<typeof loadSpellingReport>>;

// A level's code (KG1 … GRADE2): the spelling rules are set per level code.
export async function levelCodeOf(levelId: string | null) {
  if (!levelId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("levels").select("code").eq("id", levelId).maybeSingle();
  if (error) throw error;
  return data?.code ?? null;
}

// Spelling targets that practise one phonics pattern (focus pattern), the child's level
// first: review for a pattern often misspelled ("th" → this, thin, bath).
export async function spellingWordsForPattern(patternId: string, levelId: string | null, limit = 6) {
  if (!/^[0-9a-f-]{36}$/i.test(patternId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spelling_words")
    .select("word_id, level_id, difficulty")
    .eq("phonics_pattern_id", patternId)
    .eq("status", "published")
    .order("difficulty")
    .limit(40);
  if (error) throw error;
  return [...(data ?? [])]
    .sort((a, b) => Number(b.level_id === levelId) - Number(a.level_id === levelId))
    .slice(0, limit)
    .map((r) => r.word_id);
}

// Word families with at least two spelling targets: practise a spelling pattern through
// words that end the same way (-at: bat, rat, cat).
export async function loadSpellingFamilies() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("word_families")
    .select(
      "code, rime, title, emoji, sort_order, word_family_members(word_id, words!inner(spelling_words!inner(status)))",
    )
    .eq("status", "published")
    .order("sort_order")
    .limit(60);
  if (error) throw error;
  return (data ?? []).flatMap((f) => {
    const wordIds = (f.word_family_members ?? [])
      .filter((m) => {
        const targets = one(m.words)?.spelling_words;
        const list = Array.isArray(targets) ? targets : targets ? [targets] : [];
        return list.some((t) => t.status === "published");
      })
      .map((m) => m.word_id);
    return wordIds.length >= 2
      ? [{ code: f.code, rime: f.rime, title: f.title, emoji: f.emoji, wordIds }]
      : [];
  });
}

export async function spellingWordsForFamily(code: string, limit = 6) {
  if (!/^[A-Z0-9_]{2,40}$/.test(code)) return [];
  const family = (await loadSpellingFamilies()).find((f) => f.code === code);
  return family ? family.wordIds.slice(0, limit) : [];
}
