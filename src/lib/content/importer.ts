import type { SupabaseClient } from "@supabase/supabase-js";
import { soundLabelLookup, soundToken, speechProblems } from "@/lib/audio/pronunciation";
import type { z } from "zod";
import type {
  assessmentsFileSchema,
  CurriculumFile,
  PhonicsFile,
  QuestionInput,
  ReferenceFile,
  sentencesFileSchema,
  sightWordsFileSchema,
  SpellingWordInput,
  StoryInput,
  storiesFileSchema,
  vocabularyFileSchema,
  WordInput,
} from "@/lib/content/content-schemas";
import { exampleSentenceIssues, familyMembers, findWordInSentence } from "@/lib/content/vocabulary";
import {
  categoryFacts,
  irregularPositions,
  templateSpellingFromInput,
  templateWordFromInput,
  wordForms,
  type CategoryRef,
} from "@/lib/content/word-bank";
import { normalizeWord } from "@/lib/content/csv";
import { parseActivityConfig } from "@/lib/content/activity-config";
import { BlueprintError, expandBlueprint } from "@/lib/content/lesson-blueprints";
import { validatePhonicsFile, type ValidationIssue } from "@/lib/content/phonics-validation";
import { decomposeWord, segmentsUsePattern, type PatternInfo, type PhonemeInfo } from "@/lib/learning/phonics";
import { parseQuestion } from "@/lib/content/question-schemas";
import { compileWritingAnswer, glyphProblems, type RubricTemplate, type WritingFile } from "@/lib/content/writing-content";
import { WRITING_QUESTION_TYPES } from "@/lib/learning/writing-evaluation";
import { comprehensionQuestion } from "@/lib/content/reading-content";
import {
  analyzeText,
  baseFormCandidates,
  checkTextForLevel,
  estimatedReadingSeconds,
  normalizeReadingWord,
  paragraphsOf,
  readingDifficulty,
  runningWords,
  type WordClass,
} from "@/lib/learning/reading";
import { DEFAULT_RULES, mergeLearningRules, type LearningRules } from "@/lib/learning/rules";
import {
  expandTemplate,
  TemplateError,
  type TemplateContext,
  type TemplatePattern,
  type TemplateWord,
} from "@/lib/content/templates";

// Idempotent content import. Rows are matched on natural keys (codes, word text), so
// importing the same files twice changes nothing and reports everything as "skipped".
// Content is never deleted: a lesson, activity or question that disappears from its file
// is archived, which keeps learner history that references it intact. Link tables
// (word ↔ pattern, sentence ↔ word, ...) are replaced per parent.
//
// Runs with a service-role client (scripts/content/import.ts); the admin CMS will call
// the same function behind an admin check.

type WritingRefs = {
  skills: Map<string, { minRank: number; maxRank: number }>;
  glyphs: Map<string, string>;
  rubrics: Map<string, RubricTemplate & { minRank: number; maxRank: number }>;
};

export type ImportBundle = {
  reference?: ReferenceFile;
  phonics?: PhonicsFile;
  words?: WordInput[];
  sightWords?: z.infer<typeof sightWordsFileSchema>;
  sentences?: z.infer<typeof sentencesFileSchema>;
  vocabulary?: z.infer<typeof vocabularyFileSchema>;
  stories?: z.infer<typeof storiesFileSchema>;
  // Writing: writing skills, handwriting glyphs and rubric templates (content/writing.json).
  writing?: WritingFile;
  curriculum?: CurriculumFile[];
  assessments?: z.infer<typeof assessmentsFileSchema>;
  // Spelling targets (content/spelling/*.csv): words of the bank with their spelling data.
  spelling?: SpellingWordInput[];
  // True when `spelling` is the whole list (the content folder): targets missing from it are
  // archived. A single CSV (--spelling) only adds and updates.
  spellingComplete?: boolean;
};

export type EntityReport = {
  added: number;
  updated: number;
  skipped: number;
  invalid: number;
  duplicate: number;
  archived: number;
  errors: string[];
};

export type ImportReport = Record<string, EntityReport>;

type Row = Record<string, unknown>;
type Db = SupabaseClient;

const BATCH_SIZE = 500;
// Ids per filter in a request URL (`id=in.(…)`): 36-character uuids, kept well under the
// URL length limits of the API gateway.
const ID_BATCH_SIZE = 150;
const EXAMPLE_EXTRA_WORDS = 3;
// Tables whose primary key is their code (no uuid id column).
const CODE_KEYED_TABLES = new Set([
  "skill_dimensions",
  "activity_types",
  "learning_rules",
  "phonemes",
  "phonics_stages",
  "spelling_types",
  "reading_skill_types",
  "reading_content_types",
  "writing_skill_types",
]);

type Flag = { entity: string; entity_key: string; rule: string; severity: "warning" | "error"; message: string };
const PAGE_SIZE = 1000;

function emptyReport(): EntityReport {
  return { added: 0, updated: 0, skipped: 0, invalid: 0, duplicate: 0, archived: 0, errors: [] };
}

// Key-order-independent JSON, so {"a":1,"b":2} equals {"b":2,"a":1}.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Row)
      .filter((k) => (value as Row)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Row)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

type Filter =
  { op: "eq" | "neq"; column: string; value: unknown } | { op: "in"; column: string; value: unknown[] };

async function fetchAll(db: Db, table: string, columns = "*", filters: Filter[] = []): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = db
      .from(table)
      .select(columns)
      .range(from, from + PAGE_SIZE - 1);
    for (const f of filters) {
      query =
        f.op === "in"
          ? query.in(f.column, f.value)
          : f.op === "eq"
            ? query.eq(f.column, f.value)
            : query.neq(f.column, f.value);
    }
    const { data, error } = await query;
    if (error) throw new Error(`reading ${table}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

export class ContentImporter {
  readonly report: ImportReport = {};
  private readonly ids = new Map<string, Map<string, string>>();
  private wordBank = new Map<string, TemplateWord>();
  private patternBank = new Map<string, TemplatePattern>();
  // Full pattern and phoneme data for word decomposition (src/lib/learning/phonics.ts).
  private phonicsPatterns: PatternInfo[] | null = null;
  private phonemeInfo: Map<string, PhonemeInfo> | null = null;
  // Questionable content found on this run, for admin review (content_flags), and the
  // entity kinds whose flags this run replaces.
  private flags: Flag[] = [];
  private flagScopes = new Set<string>();
  // Vocabulary: categories and level ranks (1 = KG1) for the word bank, example sentences
  // waiting for the sentence bank, and sentences owned by sentences.json (not by a word).
  private categoryRefs: Map<string, CategoryRef> | null = null;
  private levelRanks: Map<string, number> | null = null;
  private pendingExamples: { wordKey: string; texts: string[]; levelId: string; difficulty: number }[] = [];
  private sentenceFileTexts = new Set<string>();
  // The level rank of the curriculum file being imported (template distractor difficulty).
  private currentLevelRank: number | undefined;
  // Spelling: the engine rules (stored overrides merged over the defaults), the level's
  // spelling settings for the curriculum file being imported, and the validated spelling
  // rows waiting for their skills (written after the curriculum).
  private learningRules: LearningRules | null = null;
  private currentSpellingLevel: LearningRules["spelling"]["levels"][string] | undefined;
  private pendingSpelling: { input: SpellingWordInput; row: Row }[] = [];
  // Reading: the reading skill and content type lists (from the reference file of this run,
  // else the database) and the validated stories, for the `reading` lesson blueprint.
  private readingRefs: {
    skills: Map<string, number>;
    contentTypes: Map<string, number>;
  } | null = null;
  private storyBank = new Map<string, { input: StoryInput; levelCode: string; patternWords: Map<string, string> }>();
  // Writing: writing skills (level ranges), glyph codes → ids and rubric templates, from
  // the writing file of this run, else the database.
  private writingRefs: WritingRefs | null = null;

  constructor(
    private readonly db: Db,
    private readonly options: { dryRun: boolean },
  ) {}

  private entity(name: string) {
    return (this.report[name] ??= emptyReport());
  }

  private idMap(table: string) {
    let map = this.ids.get(table);
    if (!map) this.ids.set(table, (map = new Map()));
    return map;
  }

  private async loadIds(table: string, keyColumns: string[]) {
    const map = this.idMap(table);
    const idColumn = CODE_KEYED_TABLES.has(table) ? "code" : "id";
    for (const row of await fetchAll(this.db, table, [idColumn, ...keyColumns].join(","))) {
      map.set(keyColumns.map((c) => String(row[c])).join("|"), String(row[idColumn]));
    }
    return map;
  }

  private lookup(table: string, key: string | undefined, what: string): string {
    if (key === undefined) throw new Error(`missing ${what}`);
    const id = this.idMap(table).get(key);
    if (!id) throw new Error(`unknown ${what} "${key}"`);
    return id;
  }

  // Upserts rows keyed by `keyColumns`, counting added/updated/skipped/duplicate.
  private async sync(
    table: string,
    entity: string,
    keyColumns: string[],
    rows: Row[],
  ): Promise<Map<string, string>> {
    const report = this.entity(entity);
    const idColumn = CODE_KEYED_TABLES.has(table) ? "code" : "id";
    const existing = new Map<string, Row>();
    for (const row of await fetchAll(this.db, table))
      existing.set(keyColumns.map((c) => String(row[c])).join("|"), row);

    const seen = new Set<string>();
    const changed: Row[] = [];
    for (const row of rows) {
      const key = keyColumns.map((c) => String(row[c])).join("|");
      if (seen.has(key)) {
        report.duplicate++;
        report.errors.push(`${entity} "${key}" appears more than once; kept the first`);
        continue;
      }
      seen.add(key);
      const current = existing.get(key);
      if (!current) {
        report.added++;
        changed.push(row);
      } else if (Object.keys(row).some((col) => stable(row[col]) !== stable(current[col]))) {
        report.updated++;
        changed.push(row);
      } else {
        report.skipped++;
      }
    }

    const map = this.idMap(table);
    for (const [key, row] of existing) map.set(key, String(row[idColumn]));
    if (this.options.dryRun) {
      for (const row of changed) {
        const key = keyColumns.map((c) => String(row[c])).join("|");
        if (!map.has(key)) map.set(key, `dry-run:${table}:${key}`);
      }
      return map;
    }
    for (let i = 0; i < changed.length; i += BATCH_SIZE) {
      const batch = changed.slice(i, i + BATCH_SIZE);
      const { data, error } = await this.db
        .from(table)
        .upsert(batch, { onConflict: keyColumns.join(",") })
        .select([idColumn, ...keyColumns].join(","));
      if (error) throw new Error(`writing ${table}: ${error.message}`);
      for (const row of (data ?? []) as unknown as Row[])
        map.set(keyColumns.map((c) => String(row[c])).join("|"), String(row[idColumn]));
    }
    return map;
  }

  // Replaces the link rows belonging to `parentIds` with `rows`.
  private async syncLinks(
    table: string,
    parentColumn: string,
    parentIds: string[],
    rows: Row[],
    keyColumns: string[],
  ) {
    if (this.options.dryRun || parentIds.length === 0) return;
    const realParents = parentIds.filter((id) => !id.startsWith("dry-run:"));
    for (let i = 0; i < realParents.length; i += ID_BATCH_SIZE) {
      const { error } = await this.db
        .from(table)
        .delete()
        .in(parentColumn, realParents.slice(i, i + ID_BATCH_SIZE));
      if (error) throw new Error(`clearing ${table}: ${error.message}`);
    }
    const unique = new Map(rows.map((r) => [keyColumns.map((c) => String(r[c])).join("|"), r]));
    const all = [...unique.values()];
    for (let i = 0; i < all.length; i += BATCH_SIZE) {
      const { error } = await this.db.from(table).insert(all.slice(i, i + BATCH_SIZE));
      if (error) throw new Error(`writing ${table}: ${error.message}`);
    }
  }

  // Archives published children of `parentIds` that the import no longer mentions.
  private async archiveMissing(
    table: string,
    entity: string,
    parentColumn: string,
    parentIds: string[],
    keptIds: Set<string>,
  ) {
    const realParents = parentIds.filter((id) => !id.startsWith("dry-run:"));
    if (realParents.length === 0) return;
    const rows = await fetchAll(this.db, table, "id,status", [
      { op: "in", column: parentColumn, value: realParents },
      { op: "neq", column: "status", value: "archived" },
    ]);
    const stale = rows.map((r) => String(r.id)).filter((id) => !keptIds.has(id));
    this.entity(entity).archived += stale.length;
    if (this.options.dryRun || stale.length === 0) return;
    const { error } = await this.db.from(table).update({ status: "archived" }).in("id", stale);
    if (error) throw new Error(`archiving ${table}: ${error.message}`);
  }

  async importReference(file: ReferenceFile) {
    await this.sync(
      "levels",
      "levels",
      ["code"],
      file.levels.map((l) => ({
        code: l.code,
        name: l.name,
        short_name: l.shortName,
        description: l.description,
        sort_order: l.sortOrder,
        min_age: l.minAge,
        max_age: l.maxAge,
        difficulty: l.difficulty,
        vocabulary_target: l.vocabularyTarget,
        sight_word_target: l.sightWordTarget,
        max_sentence_words: l.maxSentenceWords,
        phonics_scope: l.phonicsScope,
        reading_complexity: l.readingComplexity,
        writing_complexity: l.writingComplexity,
        assessment_difficulty: l.assessmentDifficulty,
        theme_emoji: l.themeEmoji,
        status: l.status,
      })),
    );
    await this.sync(
      "subjects",
      "subjects",
      ["code"],
      file.subjects.map((s) => ({
        code: s.code,
        name: s.name,
        description: s.description,
        emoji: s.emoji,
        sort_order: s.sortOrder,
        status: s.status,
      })),
    );
    await this.sync(
      "skill_dimensions",
      "skill dimensions",
      ["code"],
      file.skillDimensions.map((d) => ({
        code: d.code,
        name: d.name,
        description: d.description,
        sort_order: d.sortOrder,
      })),
    );
    await this.sync(
      "activity_types",
      "activity types",
      ["code"],
      file.activityTypes.map((t) => ({
        code: t.code,
        name: t.name,
        description: t.description,
        is_scored: t.isScored,
      })),
    );
    // Categories first, then their parents once every category exists.
    const categoryReport = this.entity("word categories");
    const knownCategories = new Set(file.wordCategories.map((c) => c.code));
    const categories = file.wordCategories.filter((c) => {
      if (!c.parent) return true;
      const parent = file.wordCategories.find((p) => p.code === c.parent);
      const problem = !knownCategories.has(c.parent)
        ? `unknown parent "${c.parent}"`
        : parent?.parent
          ? "sub-categories are one level deep"
          : c.parent === c.code
            ? "a category cannot be its own parent"
            : null;
      if (!problem) return true;
      categoryReport.invalid++;
      categoryReport.errors.push(`category ${c.code}: ${problem}`);
      return false;
    });
    const categoryIds = await this.sync(
      "word_categories",
      "word categories",
      ["code"],
      categories.map((c) => ({
        code: c.code,
        name: c.name,
        emoji: c.emoji,
        description: c.description,
        sort_order: c.sortOrder,
        status: c.status,
      })),
    );
    if (!this.options.dryRun) {
      for (const c of categories) {
        const parentId = c.parent ? (categoryIds.get(c.parent) ?? null) : null;
        const { error } = await this.db.from("word_categories").update({ parent_id: parentId }).eq("code", c.code);
        if (error) throw new Error(`writing word_categories: ${error.message}`);
      }
    }
    this.categoryRefs = null;
    await this.sync(
      "achievements",
      "achievements",
      ["code"],
      file.achievements.map((a) => ({
        code: a.code,
        title: a.title,
        description: a.description,
        emoji: a.emoji,
        criteria: a.criteria,
        sort_order: a.sortOrder,
        status: a.status,
      })),
    );
    await this.sync(
      "feedback_messages",
      "feedback messages",
      ["code"],
      file.feedback.map((f, i) => ({
        code: f.code,
        kind: f.kind,
        text: f.text,
        speech: f.speech,
        emoji: f.emoji,
        error_category: f.errorCategory ?? null,
        sort_order: i,
        status: f.status,
      })),
    );
    await this.sync(
      "spelling_types",
      "spelling types",
      ["code"],
      file.spellingTypes.map((t) => ({
        code: t.code,
        name: t.name,
        child_name: t.childName,
        description: t.description,
        emoji: t.emoji,
        sort_order: t.sortOrder,
        status: t.status,
      })),
    );
    await this.sync(
      "reading_skill_types",
      "reading skill types",
      ["code"],
      file.readingSkills.map((t) => ({
        code: t.code,
        name: t.name,
        child_name: t.childName,
        description: t.description,
        min_level_rank: t.minLevelRank,
        strand: t.strand,
        emoji: t.emoji,
        sort_order: t.sortOrder,
        status: t.status,
      })),
    );
    await this.sync(
      "reading_content_types",
      "reading content types",
      ["code"],
      file.readingContentTypes.map((t) => ({
        code: t.code,
        name: t.name,
        child_name: t.childName,
        description: t.description,
        min_level_rank: t.minLevelRank,
        emoji: t.emoji,
        sort_order: t.sortOrder,
        status: t.status,
      })),
    );
    if (file.readingSkills.length > 0 || file.readingContentTypes.length > 0)
      this.readingRefs = {
        skills: new Map(file.readingSkills.map((t) => [t.code, t.minLevelRank])),
        contentTypes: new Map(file.readingContentTypes.map((t) => [t.code, t.minLevelRank])),
      };
    // Rule overrides are validated against the engine's schemas before they are stored.
    const rulesReport = this.entity("learning rules");
    const validRules = file.rules.filter((r) => {
      const { errors } = mergeLearningRules([r]);
      if (errors.length === 0) return true;
      rulesReport.invalid++;
      rulesReport.errors.push(`rules ${r.code}: ${errors.join("; ")}`);
      return false;
    });
    await this.sync(
      "learning_rules",
      "learning rules",
      ["code"],
      validRules.map((r) => ({ code: r.code, description: r.description, config: r.config })),
    );
    this.learningRules = mergeLearningRules(validRules).rules;
  }

  // The engine rules as stored (or as just imported), for spelling progression checks.
  private async rules() {
    if (!this.learningRules) {
      const rows = await fetchAll(this.db, "learning_rules", "code,config");
      this.learningRules = mergeLearningRules(rows.map((r) => ({ code: String(r.code), config: r.config }))).rules;
    }
    return this.learningRules ?? DEFAULT_RULES;
  }

  private flag(issue: ValidationIssue | Flag, severity: "warning" | "error" = "warning") {
    const f: Flag =
      "entity_key" in issue
        ? issue
        : { entity: issue.entity, entity_key: issue.key, rule: issue.rule, severity, message: issue.message };
    this.flags.push({ ...f, message: f.message.slice(0, 400), entity_key: f.entity_key.slice(0, 160) });
  }

  async importPhonics(file: PhonicsFile) {
    await this.loadIds("levels", ["code"]);
    this.flagScopes.add("phonics_pattern");
    const report = this.entity("phonics patterns");
    const validation = validatePhonicsFile(file, new Set(this.idMap("levels").keys()));
    const rejected = new Set(validation.errors.map((e) => e.key));
    for (const e of validation.errors) {
      report.invalid++;
      report.errors.push(`pattern ${e.key}: ${e.message}`);
    }
    for (const w of validation.warnings) this.flag(w);

    // Recorded clips of single sounds (optional; they win over speech synthesis).
    const phonemeAudio = file.phonemes
      .filter((ph) => ph.audio)
      .map((ph) => ({
        storage_path: ph.audio,
        kind: "phoneme",
        content_key: `phoneme:${ph.code}`,
        tts_text: soundToken([ph.code]),
        status: "published",
      }));
    const phonemeAudioIds = phonemeAudio.length
      ? await this.sync("audio_assets", "audio assets", ["storage_path"], phonemeAudio)
      : new Map<string, string>();
    await this.sync(
      "phonemes",
      "phonemes",
      ["code"],
      file.phonemes.map((ph, i) => ({
        code: ph.code,
        ipa: ph.ipa,
        label: ph.label,
        say_as: ph.sayAs,
        tts_quality: ph.ttsQuality,
        keyword: ph.keyword ?? "",
        keyword_position: ph.keywordPosition,
        audio_asset_id: ph.audio ? (phonemeAudioIds.get(ph.audio) ?? null) : null,
        kind: ph.kind,
        voiced: ph.voiced,
        example_word: ph.example,
        description: ph.description,
        sort_order: i,
      })),
    );
    await this.sync(
      "phonics_stages",
      "phonics stages",
      ["code"],
      file.stages.map((st, i) => ({
        code: st.code,
        name: st.name,
        child_name: st.childName,
        description: st.description,
        emoji: st.emoji,
        sort_order: i,
      })),
    );
    // A pattern's SOUND recording, and (letters) a separate recording of the letter's NAME.
    const audioRows = [
      ...file.patterns
        .filter((p) => p.audio)
        .map((p) => ({
          storage_path: p.audio,
          kind: "phoneme",
          content_key: `pattern_sound:${p.code}`,
          tts_text: soundToken(p.sounds.find((s) => s.primary)?.phonemes ?? []),
          status: "published",
        })),
      ...file.patterns
        .filter((p) => p.letterNameAudio && p.type === "letter")
        .map((p) => ({
          storage_path: p.letterNameAudio,
          kind: "letter_name",
          content_key: `letter_name:${p.pattern}`,
          tts_text: p.letterNameSayAs || p.pattern.toUpperCase(),
          status: "published",
        })),
    ];
    const audioIds = audioRows.length
      ? await this.sync("audio_assets", "audio assets", ["storage_path"], audioRows)
      : new Map<string, string>();

    const patterns = file.patterns.filter((p) => !rejected.has(p.code));
    const rows: Row[] = [];
    for (const p of patterns) {
      try {
        rows.push({
          code: p.code,
          pattern: p.pattern,
          pattern_type: p.type,
          level_id: this.lookup("levels", p.level, "level"),
          difficulty: p.difficulty,
          explanation: p.explanation,
          child_explanation: p.childExplanation,
          mastery_threshold: p.masteryThreshold,
          sort_order: p.sortOrder,
          stage_code: p.stage ?? null,
          position: p.position,
          uppercase: p.uppercase ?? null,
          letter_name: p.letterName,
          letter_name_say_as: p.letterNameSayAs,
          audio_asset_id: p.audio ? (audioIds.get(p.audio) ?? null) : null,
          letter_name_audio_asset_id:
            p.letterNameAudio && p.type === "letter" ? (audioIds.get(p.letterNameAudio) ?? null) : null,
          status: p.status,
        });
      } catch (error) {
        report.invalid++;
        report.errors.push(`pattern ${p.code}: ${(error as Error).message}`);
      }
    }
    const patternIds = await this.sync("phonics_patterns", "phonics patterns", ["code"], rows);
    const soundRows = patterns
      .filter((p) => patternIds.has(p.code))
      .flatMap((p) =>
        p.sounds.map((s, i) => ({
          pattern_id: patternIds.get(p.code),
          code: s.code,
          ipa: s.ipa,
          label: s.label,
          say_as: s.sayAs,
          tts_quality: s.ttsQuality,
          keyword: s.keyword ?? "",
          keyword_position: s.keywordPosition,
          is_primary: s.primary,
          sort_order: i,
          phonemes: s.phonemes,
        })),
      );
    // The one-primary-per-pattern index would reject swapping which sound is primary in
    // a single upsert, so clear the flag first — only on patterns whose primary changes.
    if (!this.options.dryRun) {
      const currentPrimary = new Map(
        (
          await fetchAll(this.db, "phonics_pattern_sounds", "pattern_id,code", [
            { op: "eq", column: "is_primary", value: true },
          ])
        ).map((r) => [r.pattern_id, r.code]),
      );
      const changing = patterns
        .map((p) => ({ id: patternIds.get(p.code), primary: p.sounds.find((x) => x.primary)?.code }))
        .filter((p) => p.id && currentPrimary.has(p.id) && currentPrimary.get(p.id) !== p.primary)
        .map((p) => p.id!);
      if (changing.length)
        await this.db.from("phonics_pattern_sounds").update({ is_primary: false }).in("pattern_id", changing);
    }
    await this.sync("phonics_pattern_sounds", "phonics sounds", ["pattern_id", "code"], soundRows);

    const relationRows = patterns.flatMap((p) =>
      p.relations
        .filter((r) => patternIds.has(r.code))
        .map((r) => ({
          pattern_id: patternIds.get(p.code),
          related_pattern_id: patternIds.get(r.code),
          relation_type: r.type,
        })),
    );
    await this.syncLinks(
      "phonics_pattern_relations",
      "pattern_id",
      patterns.map((p) => patternIds.get(p.code)!).filter(Boolean),
      relationRows,
      ["pattern_id", "related_pattern_id", "relation_type"],
    );

    this.phonemeInfo = new Map(
      file.phonemes.map((ph) => [
        ph.code,
        { code: ph.code, ipa: ph.ipa, label: ph.label, sayAs: soundToken([ph.code]), kind: ph.kind, voiced: ph.voiced },
      ]),
    );
    this.phonicsPatterns = patterns.map((p) => ({
      code: p.code,
      pattern: p.pattern,
      type: p.type,
      position: p.position,
      sounds: p.sounds.map((s) => ({
        code: s.code,
        label: s.label,
        sayAs: soundToken(s.phonemes),
        phonemes: s.phonemes,
        primary: s.primary,
      })),
    }));
    for (const p of patterns) {
      this.patternBank.set(p.code, {
        code: p.code,
        pattern: p.pattern,
        type: p.type,
        childExplanation: p.childExplanation,
        uppercase: p.uppercase ?? null,
        letterName: p.letterName,
        letterNameSayAs: p.letterNameSayAs,
        sounds: p.sounds.map((s) => ({
          code: s.code,
          label: s.label,
          sayAs: soundToken(s.phonemes),
          primary: s.primary,
          phonemes: s.phonemes,
        })),
      });
    }
  }

  // Patterns (with pronunciations and phonemes) and the phoneme inventory, from this run
  // or from the database, for word decomposition.
  private async ensurePhonicsData() {
    if (this.phonicsPatterns && this.phonemeInfo) return;
    const [phonemes, patterns, sounds] = await Promise.all([
      fetchAll(this.db, "phonemes", "code,ipa,label,say_as,kind,voiced"),
      fetchAll(this.db, "phonics_patterns", "id,code,pattern,pattern_type,position"),
      fetchAll(this.db, "phonics_pattern_sounds", "pattern_id,code,label,say_as,is_primary,sort_order,phonemes"),
    ]);
    this.phonemeInfo = new Map(
      phonemes.map((ph) => [
        String(ph.code),
        {
          code: String(ph.code),
          ipa: String(ph.ipa),
          label: String(ph.label),
          sayAs: soundToken([String(ph.code)]),
          kind: ph.kind as PhonemeInfo["kind"],
          voiced: Boolean(ph.voiced),
        },
      ]),
    );
    this.phonicsPatterns = patterns.map((p) => ({
      code: String(p.code),
      pattern: String(p.pattern),
      type: String(p.pattern_type),
      position: p.position as PatternInfo["position"],
      sounds: sounds
        .filter((s) => s.pattern_id === p.id)
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
        .map((s) => ({
          code: String(s.code),
          label: String(s.label),
          sayAs: soundToken((s.phonemes as string[]) ?? []),
          phonemes: (s.phonemes as string[]) ?? [],
          primary: Boolean(s.is_primary),
        })),
    }));
  }

  // Categories (with their parent) and level ranks, for the word bank.
  private async loadVocabularyRefs() {
    if (!this.categoryRefs) {
      const rows = await fetchAll(this.db, "word_categories", "id,code,name,emoji,parent_id");
      const codeOf = new Map(rows.map((r) => [String(r.id), String(r.code)]));
      this.categoryRefs = new Map(
        rows.map((r) => [
          String(r.code),
          {
            code: String(r.code),
            name: String(r.name),
            emoji: String(r.emoji),
            parent: r.parent_id ? (codeOf.get(String(r.parent_id)) ?? null) : null,
          },
        ]),
      );
    }
    if (!this.levelRanks) {
      const rows = await fetchAll(this.db, "levels", "code,sort_order");
      const sorted = [...rows].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
      this.levelRanks = new Map(sorted.map((r, i) => [String(r.code), i + 1]));
    }
    return { categories: this.categoryRefs, levelRanks: this.levelRanks };
  }

  async importWords(words: WordInput[]) {
    await Promise.all([
      this.loadIds("levels", ["code"]),
      this.loadIds("word_categories", ["code"]),
      this.loadIds("phonics_patterns", ["code"]),
      this.loadIds("image_assets", ["storage_path"]),
      this.loadIds("audio_assets", ["storage_path"]),
    ]);
    await this.ensurePhonicsData();
    const refs = await this.loadVocabularyRefs();
    // Example sentences are heard as well as read, so they may be a little longer than the
    // sentences a child at that level reads alone (EXAMPLE_EXTRA_WORDS).
    const maxWords = new Map(
      (await fetchAll(this.db, "levels", "code,max_sentence_words")).map((l) => [
        String(l.code),
        Number(l.max_sentence_words) ? Number(l.max_sentence_words) + EXAMPLE_EXTRA_WORDS : undefined,
      ]),
    );
    this.flagScopes.add("word");
    const report = this.entity("words");
    const rows: Row[] = [];
    const valid: WordInput[] = [];
    const splits = new Map<string, ReturnType<typeof decomposeWord>>();
    for (const w of words) {
      try {
        // Grapheme split and phonemes (ship = sh·i·p = SH IH P). Anything doubtful is
        // flagged for review, never silently "fixed".
        const split = decomposeWord({
          word: w.word,
          patterns: this.phonicsPatterns!,
          links: w.patterns,
          phonemes: this.phonemeInfo!,
          irregular: w.irregular,
          authored: w.segments,
        });
        splits.set(normalizeWord(w.word), split);
        if (split.issues.length > 0 && !w.irregular)
          this.flag({
            entity: "word",
            entity_key: w.word,
            rule: "decomposition",
            severity: "warning",
            message: split.issues.join("; "),
          });
        // A sub-category must belong to the category it is listed with.
        if (w.subcategory) {
          const sub = refs.categories.get(w.subcategory);
          if (!sub) throw new Error(`unknown subcategory "${w.subcategory}"`);
          if (!w.category || sub.parent !== w.category)
            throw new Error(`subcategory ${w.subcategory} is not part of category ${w.category ?? "(none)"}`);
        }
        for (const level of w.levels) this.lookup("levels", level, "level");
        // Example sentences: simple, about the word, short enough for the level.
        const forms = wordForms(w);
        for (const example of [w.exampleSentence, ...w.examples].filter(Boolean)) {
          const issues = exampleSentenceIssues(example, w.word, forms, maxWords.get(w.level));
          if (issues.length)
            this.flag({
              entity: "word",
              entity_key: w.word,
              rule: "example_sentence",
              severity: "warning",
              message: `"${example}" ${issues.join("; ")}`,
            });
        }
        if (!w.childDefinition && !w.sightWord && w.status === "published")
          this.flag({
            entity: "word",
            entity_key: w.word,
            rule: "missing_meaning",
            severity: "warning",
            message: "no child-friendly meaning",
          });
        const row = {
          word: w.word,
          normalized_word: normalizeWord(w.word),
          sense: w.sense,
          level_id: this.lookup("levels", w.level, "level"),
          category_id: w.subcategory
            ? this.lookup("word_categories", w.subcategory, "subcategory")
            : w.category
              ? this.lookup("word_categories", w.category, "category")
              : null,
          difficulty: w.difficulty,
          syllable_count: w.syllables,
          pronunciation: w.pronunciation,
          definition: w.definition,
          child_definition: w.childDefinition,
          part_of_speech: w.partOfSpeech,
          is_sight_word: w.sightWord,
          is_irregular: w.irregular,
          spelling_note: w.spellingNote,
          example_sentence: w.exampleSentence,
          plural: w.plural,
          inflections: w.inflections,
          tags: w.tags,
          emoji: w.emoji,
          image_asset_id: w.image ? this.lookup("image_assets", w.image, "image") : null,
          audio_asset_id: w.audio ? this.lookup("audio_assets", w.audio, "audio recording") : null,
          phonics_shape: split.shape,
          decodable: split.decodable,
          segments_source: w.segments ? "authored" : "auto",
          status: w.status,
        };
        for (const p of w.patterns) this.lookup("phonics_patterns", p.code, "phonics pattern");
        rows.push(row);
        valid.push(w);
      } catch (error) {
        report.invalid++;
        report.errors.push(`word "${w.word}": ${(error as Error).message}`);
      }
    }
    const wordIds = await this.sync("words", "words", ["normalized_word", "sense"], rows);
    const idOf = (w: { word: string; sense?: number }) =>
      wordIds.get(`${normalizeWord(w.word)}|${w.sense ?? 1}`);

    // Pattern links (with the specific sound, when the pattern has several).
    const sounds = await fetchAll(this.db, "phonics_pattern_sounds", "id,pattern_id,code");
    const soundId = (patternId: string, code?: string) =>
      code ? sounds.find((s) => s.pattern_id === patternId && s.code === code)?.id : undefined;
    const links: Row[] = [];
    for (const w of valid) {
      for (const p of w.patterns) {
        const patternId = this.lookup("phonics_patterns", p.code, "phonics pattern");
        const sid = soundId(patternId, p.sound);
        if (p.sound && !sid && !this.options.dryRun) {
          report.errors.push(
            `word "${w.word}": sound ${p.sound} is not defined for ${p.code}; linked without a sound`,
          );
        }
        links.push({ word_id: idOf(w), pattern_id: patternId, sound_id: sid ?? null, is_example: p.example });
      }
    }
    await this.syncLinks(
      "word_phonics_patterns",
      "word_id",
      valid.map((w) => idOf(w)!).filter(Boolean),
      links,
      ["word_id", "pattern_id"],
    );

    // Grapheme segments, replaced per word.
    const segmentRows: Row[] = [];
    for (const w of valid) {
      const split = splits.get(normalizeWord(w.word));
      if (!split) continue;
      split.segments.forEach((seg, position) => {
        const patternId = seg.patternCode ? this.idMap("phonics_patterns").get(seg.patternCode) : undefined;
        segmentRows.push({
          word_id: idOf(w),
          position,
          grapheme: seg.grapheme,
          pattern_id: patternId ?? null,
          sound_id: patternId ? (soundId(patternId, seg.soundCode ?? undefined) ?? null) : null,
          phonemes: seg.phonemes,
        });
      });
    }
    await this.syncLinks(
      "word_segments",
      "word_id",
      valid.map((w) => idOf(w)!).filter(Boolean),
      segmentRows.filter((r) => r.word_id),
      ["word_id", "position"],
    );

    // Relations, once every word exists: listed related words, synonyms and antonyms, and
    // the word's own forms when they are words of the bank (mouse → mice).
    const relations: Row[] = [];
    const FORM_RELATION: Record<string, string> = {
      plural: "plural",
      past: "verb_form",
      past_participle: "verb_form",
      ing: "verb_form",
      third_person: "verb_form",
      comparative: "adjective_form",
      superlative: "adjective_form",
    };
    for (const w of valid) {
      const listed: [string, string][] = [
        ...w.related.map((x): [string, string] => [x, "related"]),
        ...w.synonyms.map((x): [string, string] => [x, "synonym"]),
        ...w.antonyms.map((x): [string, string] => [x, "antonym"]),
      ];
      for (const [related, type] of listed) {
        const relatedId = wordIds.get(`${normalizeWord(related)}|1`);
        if (!relatedId) {
          report.errors.push(`word "${w.word}": ${type} "${related}" is not in the word bank`);
          continue;
        }
        if (relatedId === idOf(w)) {
          report.errors.push(`word "${w.word}": a word cannot be its own ${type}`);
          continue;
        }
        relations.push({ word_id: idOf(w), related_word_id: relatedId, relation_type: type });
      }
      const forms: [string, string][] = [
        ...(w.plural ? [["plural", w.plural] as [string, string]] : []),
        ...Object.entries(w.inflections),
      ];
      for (const [key, form] of forms) {
        const formId = wordIds.get(`${normalizeWord(form)}|1`);
        if (formId && formId !== idOf(w))
          relations.push({ word_id: idOf(w), related_word_id: formId, relation_type: FORM_RELATION[key] });
      }
    }
    await this.syncLinks("word_relations", "word_id", valid.map((w) => idOf(w)!).filter(Boolean), relations, [
      "word_id",
      "related_word_id",
      "relation_type",
    ]);

    // Levels: the introducing level (primary) and the further levels the word suits.
    const levelLinks: Row[] = [];
    for (const w of valid) {
      const wordId = idOf(w);
      levelLinks.push({ word_id: wordId, level_id: this.lookup("levels", w.level, "level"), is_primary: true });
      for (const level of w.levels.filter((l) => l !== w.level))
        levelLinks.push({ word_id: wordId, level_id: this.lookup("levels", level, "level"), is_primary: false });
    }
    await this.syncLinks(
      "word_levels",
      "word_id",
      valid.map((w) => idOf(w)!).filter(Boolean),
      levelLinks.filter((r) => r.word_id),
      ["word_id", "level_id"],
    );

    // Example sentences go into the sentence bank once it is imported (importWordExamples).
    for (const w of valid) {
      const texts = [...new Set([w.exampleSentence, ...w.examples].filter(Boolean))];
      this.pendingExamples.push({
        wordKey: `${normalizeWord(w.word)}|${w.sense}`,
        texts,
        levelId: this.lookup("levels", w.level, "level"),
        difficulty: w.difficulty,
      });
    }

    for (const w of valid) {
      if (w.sense !== 1) continue;
      const segments = (splits.get(normalizeWord(w.word))?.segments ?? []).map((seg) => ({
        grapheme: seg.grapheme,
        patternCode: seg.patternCode,
        sayAs: soundToken(seg.phonemes),
        phonemes: seg.phonemes,
      }));
      this.wordBank.set(normalizeWord(w.word), templateWordFromInput(w, segments, refs));
    }
  }

  // Each word's curated example sentences become rows of the sentence bank (unless
  // sentences.json owns that sentence) and are linked to the word, in order. The words a
  // sentence uses are linked too (sentence_words), like any sentence.
  async importWordExamples() {
    if (this.pendingExamples.length === 0) return;
    await Promise.all([this.loadIds("words", ["normalized_word", "sense"]), this.loadIds("sentences", ["text"])]);
    const report = this.entity("example sentences");
    const rows = new Map<string, Row>();
    for (const e of this.pendingExamples)
      for (const text of e.texts)
        if (!this.sentenceFileTexts.has(text) && !rows.has(text))
          rows.set(text, {
            text,
            level_id: e.levelId,
            difficulty: e.difficulty,
            grammar_complexity: 1,
            word_count: text.split(/\s+/).length,
            status: "published",
          });
    const ids = await this.sync("sentences", "example sentences", ["text"], [...rows.values()]);
    const links: Row[] = [];
    const wordIds: string[] = [];
    for (const e of this.pendingExamples) {
      const wordId = this.idMap("words").get(e.wordKey);
      if (!wordId) continue;
      wordIds.push(wordId);
      e.texts.forEach((text, i) => {
        const sentenceId = ids.get(text) ?? this.idMap("sentences").get(text);
        if (sentenceId) links.push({ word_id: wordId, sentence_id: sentenceId, sort_order: i });
        else if (!this.options.dryRun) report.errors.push(`example "${text}" was not stored`);
      });
    }
    await this.syncLinks("word_sentences", "word_id", wordIds, links, ["word_id", "sentence_id"]);
    const sentenceIds = [...rows.keys()].map((t) => ids.get(t)!).filter(Boolean);
    const wordLinks = [...rows.keys()].flatMap((text) => {
      const sentenceId = ids.get(text);
      return sentenceId ? this.sentenceWordLinks(sentenceId, text) : [];
    });
    await this.syncLinks("sentence_words", "sentence_id", sentenceIds, wordLinks, ["sentence_id", "word_id"]);
    this.pendingExamples = [];
  }

  // Words of the bank that a sentence uses (vocabulary it depends on).
  private sentenceWordLinks(sentenceId: string, text: string): Row[] {
    const tokens = new Set(
      text
        .split(/\s+/)
        .map((t) => normalizeWord(t.replace(/[^\p{L}\p{N}']/gu, "")))
        .filter(Boolean),
    );
    return [...tokens].flatMap((token) => {
      const wordId = this.idMap("words").get(`${token}|1`);
      return wordId ? [{ sentence_id: sentenceId, word_id: wordId }] : [];
    });
  }

  // Word families (content/vocabulary.json). Members come from the word bank: one-syllable
  // words ending in the rime whose vowel makes the family's sound (familyMembers), plus
  // listed extra words, minus excluded ones.
  async importFamilies(file: z.infer<typeof vocabularyFileSchema>) {
    await Promise.all([
      this.loadIds("levels", ["code"]),
      this.loadIds("phonics_patterns", ["code"]),
      this.loadIds("words", ["normalized_word", "sense"]),
    ]);
    await this.loadBanksFromDatabase();
    const report = this.entity("word families");
    const rows: Row[] = [];
    const members = new Map<string, string[]>();
    const candidates = [...this.wordBank.values()].map((w) => ({
      word: w.word,
      syllables: w.syllables ?? 1,
      segments: (w.segments ?? []).map((seg) => ({ grapheme: seg.grapheme, phonemes: seg.phonemes })),
    }));
    for (const f of file.families) {
      try {
        let vowel: string[] = [];
        if (f.vowelPattern) {
          const pattern = this.patternBank.get(f.vowelPattern);
          if (!pattern) throw new Error(`unknown phonics pattern "${f.vowelPattern}"`);
          const sound = f.vowelSound
            ? pattern.sounds.find((x) => x.code === f.vowelSound)
            : pattern.sounds.find((x) => x.primary);
          if (!sound) throw new Error(`unknown sound "${f.vowelSound}" for ${f.vowelPattern}`);
          vowel = sound.phonemes ?? [];
        }
        const derived = familyMembers(f.rime, vowel, candidates);
        for (const extra of f.words)
          if (!this.wordBank.has(normalizeWord(extra))) throw new Error(`word "${extra}" is not in the word bank`);
        const excluded = new Set(f.exclude.map(normalizeWord));
        const list = [...new Set([...derived, ...f.words])].filter((w) => !excluded.has(normalizeWord(w)));
        if (list.length < 2) throw new Error(`has ${list.length} member(s); a family needs at least two words`);
        rows.push({
          code: f.code,
          rime: f.rime,
          title: f.title,
          level_id: this.lookup("levels", f.level, "level"),
          vowel_pattern_id: f.vowelPattern ? this.lookup("phonics_patterns", f.vowelPattern, "phonics pattern") : null,
          emoji: f.emoji,
          sort_order: f.sortOrder,
          status: f.status,
        });
        members.set(f.code, list);
      } catch (error) {
        report.invalid++;
        report.errors.push(`family ${f.code}: ${(error as Error).message}`);
      }
    }
    const ids = await this.sync("word_families", "word families", ["code"], rows);
    const links: Row[] = [];
    for (const [code, list] of members) {
      list.forEach((word, i) => {
        const wordId = this.idMap("words").get(`${normalizeWord(word)}|1`);
        if (wordId) links.push({ family_id: ids.get(code), word_id: wordId, sort_order: i });
      });
    }
    await this.syncLinks(
      "word_family_members",
      "family_id",
      [...members.keys()].map((c) => ids.get(c)!).filter(Boolean),
      links.filter((l) => l.family_id),
      ["family_id", "word_id"],
    );
  }

  // Words a template may use as distractors: published ones only (drafts never leak).
  private publishedBankCache: TemplateWord[] | null = null;
  private publishedBank() {
    if (!this.publishedBankCache || this.publishedBankCache.length === 0)
      this.publishedBankCache = [...this.wordBank.values()].filter((w) => w.published !== false);
    return this.publishedBankCache;
  }

  // Loads the word bank and patterns from the database, for imports that only contain
  // curriculum files (templates still need them).
  async loadBanksFromDatabase() {
    await this.ensurePhonicsData();
    if (this.wordBank.size === 0) {
      const refs = await this.loadVocabularyRefs();
      const [words, links, patterns, sounds, segments, categories, levels, synonyms, examples] = await Promise.all([
        fetchAll(
          this.db,
          "words",
          "id,word,emoji,child_definition,sense,category_id,level_id,part_of_speech,difficulty,syllable_count,plural,inflections,status",
        ),
        fetchAll(this.db, "word_phonics_patterns", "word_id,pattern_id,sound_id"),
        fetchAll(this.db, "phonics_patterns", "id,code"),
        fetchAll(this.db, "phonics_pattern_sounds", "id,code,say_as"),
        fetchAll(this.db, "word_segments", "word_id,position,grapheme,pattern_id,sound_id,phonemes"),
        fetchAll(this.db, "word_categories", "id,code"),
        fetchAll(this.db, "levels", "id,code"),
        fetchAll(this.db, "word_relations", "word_id,related_word_id", [
          { op: "eq", column: "relation_type", value: "synonym" },
        ]),
        fetchAll(this.db, "word_sentences", "word_id,sentence_id,sort_order,sentences(text)"),
      ]);
      const patternCode = new Map(patterns.map((p) => [p.id, String(p.code)]));
      const soundById = new Map(sounds.map((s) => [s.id, s]));
      const categoryCode = new Map(categories.map((c) => [c.id, String(c.code)]));
      const levelCode = new Map(levels.map((l) => [l.id, String(l.code)]));
      const wordText = new Map(words.map((w) => [w.id, String(w.word)]));
      for (const w of words.filter((w) => w.sense === 1)) {
        this.wordBank.set(normalizeWord(String(w.word)), {
          word: String(w.word),
          emoji: String(w.emoji),
          childDefinition: String(w.child_definition),
          ...categoryFacts(w.category_id ? categoryCode.get(w.category_id) : null, refs.categories),
          levelRank: refs.levelRanks.get(levelCode.get(w.level_id) ?? ""),
          partOfSpeech: String(w.part_of_speech),
          difficulty: Number(w.difficulty),
          syllables: Number(w.syllable_count),
          published: w.status === "published",
          examples: examples
            .filter((e) => e.word_id === w.id)
            .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
            .map((e) => String((Array.isArray(e.sentences) ? e.sentences[0] : (e.sentences as Row | null))?.text ?? ""))
            .filter(Boolean),
          synonyms: synonyms.filter((r) => r.word_id === w.id).map((r) => wordText.get(r.related_word_id) ?? ""),
          forms: wordForms({ plural: String(w.plural ?? ""), inflections: (w.inflections ?? {}) as Record<string, string> }),
          patterns: links
            .filter((l) => l.word_id === w.id)
            .map((l) => ({
              code: patternCode.get(l.pattern_id) ?? "",
              sound: l.sound_id ? (soundById.get(l.sound_id)?.code as string | undefined) : undefined,
            })),
          segments: segments
            .filter((seg) => seg.word_id === w.id)
            .sort((a, b) => Number(a.position) - Number(b.position))
            .map((seg) => {
              const phonemes = (seg.phonemes as string[]) ?? [];
              return {
                grapheme: String(seg.grapheme),
                patternCode: seg.pattern_id ? (patternCode.get(seg.pattern_id) ?? null) : null,
                // The sound token ({/SH/}); silent letters have none.
                sayAs: soundToken(phonemes),
                phonemes,
              };
            }),
        });
      }
    }
    // Spelling facts of stored spelling targets (a curriculum-only import still needs them).
    if (![...this.wordBank.values()].some((w) => w.spelling)) {
      const [spellingRows, wordRows, levelRows, patternRows] = await Promise.all([
        fetchAll(
          this.db,
          "spelling_words",
          "word_id,level_id,spelling_type_code,phonics_pattern_id,irregular_positions,hints,common_errors,is_high_frequency,sentences(text)",
          [{ op: "neq", column: "status", value: "archived" }],
        ),
        fetchAll(this.db, "words", "id,word,sense"),
        fetchAll(this.db, "levels", "id,code"),
        fetchAll(this.db, "phonics_patterns", "id,code"),
      ]);
      const wordById = new Map(wordRows.map((w) => [String(w.id), w]));
      const levelCodeById = new Map(levelRows.map((l) => [String(l.id), String(l.code)]));
      const patternCodeById = new Map(patternRows.map((p) => [String(p.id), String(p.code)]));
      for (const r of spellingRows) {
        const w = wordById.get(String(r.word_id));
        if (!w || Number(w.sense) !== 1) continue;
        const bankWord = this.wordBank.get(normalizeWord(String(w.word)));
        if (!bankWord) continue;
        const sentence = Array.isArray(r.sentences) ? r.sentences[0] : (r.sentences as Row | null);
        bankWord.spelling = {
          type: String(r.spelling_type_code),
          level: levelCodeById.get(String(r.level_id)) ?? "",
          focusPattern: r.phonics_pattern_id ? (patternCodeById.get(String(r.phonics_pattern_id)) ?? null) : null,
          irregularPositions: ((r.irregular_positions as number[]) ?? []).map(Number),
          hints: ((r.hints as { text?: string }[]) ?? []).map((h) => String(h.text ?? "")).filter(Boolean),
          sentence: sentence?.text ? String(sentence.text) : null,
          commonErrors: ((r.common_errors as { spelling?: string }[]) ?? []).map((e) => String(e.spelling ?? "")),
          highFrequency: Boolean(r.is_high_frequency),
        };
      }
    }
    if (this.patternBank.size === 0) {
      const [patterns, sounds] = await Promise.all([
        fetchAll(
          this.db,
          "phonics_patterns",
          "id,code,pattern,pattern_type,child_explanation,uppercase,letter_name,letter_name_say_as",
        ),
        fetchAll(this.db, "phonics_pattern_sounds", "pattern_id,code,label,say_as,is_primary,sort_order,phonemes"),
      ]);
      for (const p of patterns) {
        this.patternBank.set(String(p.code), {
          code: String(p.code),
          pattern: String(p.pattern),
          type: String(p.pattern_type),
          childExplanation: String(p.child_explanation),
          uppercase: (p.uppercase as string | null) ?? null,
          letterName: String(p.letter_name ?? ""),
          letterNameSayAs: String(p.letter_name_say_as ?? ""),
          sounds: sounds
            .filter((s) => s.pattern_id === p.id)
            .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
            .map((s) => ({
              code: String(s.code),
              label: String(s.label),
              sayAs: soundToken((s.phonemes as string[]) ?? []),
              primary: Boolean(s.is_primary),
              phonemes: (s.phonemes as string[]) ?? [],
            })),
        });
      }
    }
  }

  async importSightWords(file: z.infer<typeof sightWordsFileSchema>) {
    await Promise.all([
      this.loadIds("levels", ["code"]),
      this.loadIds("words", ["normalized_word", "sense"]),
    ]);
    const report = this.entity("sight words");
    const rows: Row[] = [];
    for (const list of file.lists) {
      list.words.forEach((word, i) => {
        try {
          rows.push({
            level_id: this.lookup("levels", list.level, "level"),
            word_id: this.lookup("words", `${normalizeWord(word)}|1`, "word"),
            list_name: list.listName,
            sort_order: i,
          });
        } catch (error) {
          report.invalid++;
          report.errors.push(`sight word "${word}" (${list.level}): ${(error as Error).message}`);
        }
      });
    }
    await this.sync("sight_words", "sight words", ["level_id", "word_id"], rows);
  }

  async importSentences(file: z.infer<typeof sentencesFileSchema>) {
    await Promise.all([
      this.loadIds("levels", ["code"]),
      this.loadIds("words", ["normalized_word", "sense"]),
      this.loadIds("phonics_patterns", ["code"]),
    ]);
    const report = this.entity("sentences");
    const rows: Row[] = [];
    const valid: typeof file.sentences = [];
    for (const s of file.sentences) this.sentenceFileTexts.add(s.text);
    for (const s of file.sentences) {
      try {
        rows.push({
          text: s.text,
          level_id: this.lookup("levels", s.level, "level"),
          difficulty: s.difficulty,
          grammar_complexity: s.grammarComplexity,
          word_count: s.text.split(/\s+/).length,
          emoji: s.emoji,
          status: s.status,
        });
        valid.push(s);
      } catch (error) {
        report.invalid++;
        report.errors.push(`sentence "${s.text}": ${(error as Error).message}`);
      }
    }
    const ids = await this.sync("sentences", "sentences", ["text"], rows);
    const wordLinks: Row[] = [];
    const patternLinks: Row[] = [];
    for (const s of valid) {
      const sentenceId = ids.get(s.text);
      if (sentenceId) wordLinks.push(...this.sentenceWordLinks(sentenceId, s.text));
      for (const code of s.patterns) {
        try {
          patternLinks.push({
            sentence_id: sentenceId,
            pattern_id: this.lookup("phonics_patterns", code, "phonics pattern"),
          });
        } catch (error) {
          report.errors.push(`sentence "${s.text}": ${(error as Error).message}`);
        }
      }
    }
    const sentenceIds = valid.map((s) => ids.get(s.text)!).filter(Boolean);
    await this.syncLinks("sentence_words", "sentence_id", sentenceIds, wordLinks, ["sentence_id", "word_id"]);
    await this.syncLinks("sentence_phonics_patterns", "sentence_id", sentenceIds, patternLinks, [
      "sentence_id",
      "pattern_id",
    ]);
  }

  private async loadReadingRefs() {
    if (!this.readingRefs) {
      const [skills, types] = await Promise.all([
        fetchAll(this.db, "reading_skill_types", "code,min_level_rank"),
        fetchAll(this.db, "reading_content_types", "code,min_level_rank"),
      ]);
      this.readingRefs = {
        skills: new Map(skills.map((r) => [String(r.code), Number(r.min_level_rank)])),
        contentTypes: new Map(types.map((r) => [String(r.code), Number(r.min_level_rank)])),
      };
    }
    return this.readingRefs;
  }

  // The word bank as reading sees it: every written form (plural, -ing, past…) of a
  // published word → the word, with what decodability needs (its split's patterns and the
  // level each pattern is taught at, the sight-word and irregular flags).
  private async loadReadingWordFacts() {
    const [words, segments, patterns, levels] = await Promise.all([
      fetchAll(
        this.db,
        "words",
        "id,word,normalized_word,sense,plural,inflections,decodable,is_sight_word,is_irregular,status",
        [{ op: "eq", column: "status", value: "published" }],
      ),
      fetchAll(this.db, "word_segments", "word_id,pattern_id"),
      fetchAll(this.db, "phonics_patterns", "id,code,level_id"),
      fetchAll(this.db, "levels", "id,code"),
    ]);
    const ranks = (await this.loadVocabularyRefs()).levelRanks;
    const levelCode = new Map(levels.map((l) => [String(l.id), String(l.code)]));
    const patternInfo = new Map(
      patterns.map((p) => [String(p.id), { code: String(p.code), rank: ranks.get(levelCode.get(String(p.level_id)) ?? "") ?? 99 }]),
    );
    const patternsOf = new Map<string, { code: string; rank: number }[]>();
    for (const seg of segments) {
      if (!seg.pattern_id) continue;
      const info = patternInfo.get(String(seg.pattern_id));
      if (!info) continue;
      const list = patternsOf.get(String(seg.word_id)) ?? [];
      list.push(info);
      patternsOf.set(String(seg.word_id), list);
    }
    type Fact = {
      id: string;
      word: string;
      decodable: boolean;
      sight: boolean;
      irregular: boolean;
      patterns: { code: string; rank: number }[];
    };
    const byForm = new Map<string, Fact>();
    const bases: [Row, Fact][] = [];
    for (const w of words.filter((w) => Number(w.sense) === 1)) {
      const fact: Fact = {
        id: String(w.id),
        word: String(w.word),
        decodable: w.decodable === true,
        sight: w.is_sight_word === true,
        irregular: w.is_irregular === true,
        patterns: patternsOf.get(String(w.id)) ?? [],
      };
      byForm.set(normalizeReadingWord(String(w.normalized_word)), fact);
      bases.push([w, fact]);
    }
    // Forms never shadow a base word ("saw" the tool vs "saw" the past of "see").
    for (const [w, fact] of bases)
      for (const form of wordForms({
        plural: String(w.plural ?? ""),
        inflections: (w.inflections ?? {}) as Record<string, string>,
      })) {
        const key = normalizeReadingWord(form);
        if (!byForm.has(key)) byForm.set(key, fact);
      }
    return byForm;
  }

  async importStories(file: z.infer<typeof storiesFileSchema>) {
    await Promise.all([
      this.loadIds("levels", ["code"]),
      this.loadIds("phonics_patterns", ["code"]),
      this.loadIds("image_assets", ["storage_path"]),
      this.loadIds("audio_assets", ["storage_path"]),
    ]);
    const report = this.entity("stories");
    this.flagScopes.add("story");
    const refs = await this.loadReadingRefs();
    const ranks = (await this.loadVocabularyRefs()).levelRanks;
    const facts = await this.loadReadingWordFacts();
    const rules = (await this.rules()).reading;
    const knownPhonemes = this.phonemeInfo ? new Set(this.phonemeInfo.keys()) : undefined;

    const rows: Row[] = [];
    const links: { code: string; words: Row[]; patterns: string[]; skills: string[] }[] = [];
    const titles = new Set<string>();
    for (const s of file.stories) {
      try {
        const levelId = this.lookup("levels", s.level, "level");
        const levelRank = ranks.get(s.level);
        if (levelRank === undefined) throw new Error(`level ${s.level} has no rank`);
        const normalizedTitle = s.title.trim().replace(/\s+/g, " ").toLowerCase();
        const titleKey = `${s.level}|${normalizedTitle}`;
        if (titles.has(titleKey)) {
          report.duplicate++;
          throw new Error(`another ${s.level} text is already called "${s.title}"`);
        }
        titles.add(titleKey);
        for (const p of s.targetPatterns) this.lookup("phonics_patterns", p, "phonics pattern");
        const names = new Set(s.names.map(normalizeReadingWord));
        const factOf = (word: string) =>
          facts.get(word) ??
          baseFormCandidates(word)
            .map((b) => facts.get(b))
            .find(Boolean);
        const classify = (word: string): WordClass | null => {
          const fact = factOf(word);
          if (fact)
            return {
              decodable: fact.decodable && fact.patterns.every((p) => p.rank <= levelRank),
              sight: fact.sight,
              irregular: fact.irregular,
              patterns: fact.patterns.map((p) => p.code),
            };
          // A name, or a name's possessive (Lee's).
          return names.has(word) || names.has(word.replace(/'s$/, ""))
            ? { decodable: true, sight: false, irregular: false, patterns: [] }
            : null;
        };
        const paragraphs = paragraphsOf(s.pages);
        const running = new Set(runningWords(paragraphs));
        const inText = (word: string) => {
          const fact = facts.get(normalizeReadingWord(word));
          if (!fact) throw new Error(`"${word}" is not in the word bank`);
          if (![...running].some((w) => factOf(w)?.id === fact.id)) throw new Error(`"${word}" is not in the text`);
          return fact;
        };
        const focusIds = new Set(s.focusWords.map((w) => inText(w).id));
        for (const w of s.practiceWords) inText(w);
        const analysis = analyzeText({
          paragraphs,
          classify,
          targetPatterns: s.targetPatterns,
          focusWords: s.focusWords,
        });
        // Skills the text and its questions claim, checked against the level.
        const skillCodes = [...new Set([...s.targetSkills, ...s.questions.map((q) => q.skill)])];
        const issues = checkTextForLevel({
          levelCode: s.level,
          levelRank,
          analysis: { ...analysis, unknownWords: [] },
          contentType: refs.contentTypes.has(s.contentType)
            ? { code: s.contentType, minLevelRank: refs.contentTypes.get(s.contentType)! }
            : null,
          skills: skillCodes.map((c) => (refs.skills.has(c) ? { code: c, minLevelRank: refs.skills.get(c)! } : null)),
          skillCodes,
          questionCount: s.questions.length,
          rules,
        });
        const errors = issues.filter((i) => i.severity === "error");
        if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
        for (const i of issues)
          this.flag({ entity: "story", entity_key: s.code, rule: i.rule, severity: "warning", message: i.message });
        // Words outside the word bank (other than declared names) are reported, never added.
        if (analysis.unknownWords.length)
          this.flag({
            entity: "story",
            entity_key: s.code,
            rule: "unknown_words",
            severity: "warning",
            message: `not in the word bank: ${analysis.unknownWords.join(", ")}`,
          });
        const computed = readingDifficulty(analysis, rules.difficulty);
        if (Math.abs(computed - s.difficulty) >= 3)
          this.flag({
            entity: "story",
            entity_key: s.code,
            rule: "difficulty_mismatch",
            severity: "warning",
            message: `difficulty ${s.difficulty}, but the text measures ${computed}`,
          });
        // Every comprehension question must be a valid question (and safe to speak).
        s.questions.forEach((q, i) => {
          const raw = comprehensionQuestion(s, q, i, undefined, paragraphs);
          const parsed = parseQuestion(raw.type, raw.content, raw.answer);
          if (!parsed.ok) throw new Error(`question ${i + 1}: ${parsed.error}`);
          const speech = speechProblems(raw.promptSpeech, raw.content, knownPhonemes);
          if (speech.length) throw new Error(`question ${i + 1}: speech: ${speech.join("; ")}`);
        });

        // Word links, merged per word (forms of one word count together).
        const byWord = new Map<string, Row>();
        const patternWords = new Map<string, string>();
        for (const w of analysis.words) {
          const fact = factOf(w.normalized);
          if (!fact) continue;
          const row = byWord.get(fact.id);
          if (row) {
            row.occurrences = Number(row.occurrences) + w.occurrences;
            row.first_position = Math.min(Number(row.first_position), w.firstPosition);
          } else
            byWord.set(fact.id, {
              word_id: fact.id,
              occurrences: w.occurrences,
              first_position: w.firstPosition,
              is_decodable: w.isDecodable,
              is_sight: w.isSight,
              is_irregular: w.isIrregular,
              is_target_pattern: w.isTargetPattern,
              is_focus: focusIds.has(fact.id),
            });
          // A word to find the pattern in: a real word of the text (two letters or more),
          // a decodable one when there is one.
          for (const p of s.targetPatterns) {
            if (fact.word.length < 2 || !fact.patterns.some((x) => x.code === p)) continue;
            const current = patternWords.get(p);
            const currentDecodable = current ? facts.get(normalizeReadingWord(current))?.decodable : false;
            if (!current || (fact.decodable && !currentDecodable)) patternWords.set(p, fact.word);
          }
        }
        for (const p of s.targetPatterns)
          if (!patternWords.has(p)) throw new Error(`no word of the text uses target pattern ${p}`);

        rows.push({
          code: s.code,
          title: s.title,
          normalized_title: normalizedTitle,
          level_id: levelId,
          content_type_code: s.contentType,
          difficulty: s.difficulty,
          reading_level: s.readingLevel ?? null,
          genre: s.genre,
          topic: s.topic,
          tags: s.tags,
          summary: s.summary,
          cover_emoji: s.coverEmoji,
          image_asset_id: s.image ? this.lookup("image_assets", s.image, "image") : null,
          audio_asset_id: s.audio ? this.lookup("audio_assets", s.audio, "audio recording") : null,
          pages: s.pages,
          word_count: analysis.stats.words,
          estimated_seconds: estimatedReadingSeconds(analysis.stats.words, levelRank),
          text_stats: analysis.stats,
          decodable_pct: analysis.decodablePct,
          unknown_words: analysis.unknownWords,
          is_original: s.isOriginal,
          license: s.license,
          status: s.status,
        });
        links.push({ code: s.code, words: [...byWord.values()], patterns: s.targetPatterns, skills: s.targetSkills });
        this.storyBank.set(s.code, { input: s, levelCode: s.level, patternWords });
      } catch (error) {
        report.invalid++;
        report.errors.push(`story ${s.code}: ${(error as Error).message}`);
      }
    }
    const ids = await this.sync("stories", "stories", ["code"], rows);
    const storyIds = links.map((l) => ids.get(l.code)!).filter(Boolean);
    const wordRows: Row[] = [];
    const patternRows: Row[] = [];
    const skillRows: Row[] = [];
    for (const l of links) {
      const storyId = ids.get(l.code);
      if (!storyId) continue;
      for (const w of l.words) wordRows.push({ story_id: storyId, ...w });
      for (const p of l.patterns)
        patternRows.push({ story_id: storyId, pattern_id: this.lookup("phonics_patterns", p, "phonics pattern") });
      for (const code of l.skills) skillRows.push({ story_id: storyId, reading_skill_code: code });
    }
    await this.syncLinks("story_words", "story_id", storyIds, wordRows, ["story_id", "word_id"]);
    await this.syncLinks("story_phonics_patterns", "story_id", storyIds, patternRows, ["story_id", "pattern_id"]);
    await this.syncLinks("story_reading_skills", "story_id", storyIds, skillRows, ["story_id", "reading_skill_code"]);
  }

  // Expands and validates one question; returns a row or null (reported invalid).
  private buildQuestion(
    input: QuestionInput,
    code: string,
    skillId: string,
    activityId: string | null,
    fallbackType: string,
  ): Row | null {
    const report = this.entity("questions");
    try {
      let expanded: {
        type: string;
        prompt: string;
        promptSpeech: string;
        content: Record<string, unknown>;
        answer: Record<string, unknown> | null;
        word?: string;
        pattern?: string;
        story?: string;
        area?: string;
        sentence?: string;
        spellingActivity?: string;
      };
      if ("template" in input && typeof input.template === "string") {
        const {
          template,
          code: _code,
          difficulty: _difficulty,
          skill: _skill,
          explanation: _explanation,
          ...params
        } = input;
        const ctx: TemplateContext = {
          seed: code,
          word: (text) => this.wordBank.get(normalizeWord(text)),
          words: () => this.publishedBank(),
          levelRank: this.currentLevelRank,
          spellingLevel: this.currentSpellingLevel,
          pattern: (patternCode) => this.patternBank.get(patternCode),
          phoneme: (phonemeCode) => {
            const p = this.phonemeInfo?.get(phonemeCode);
            return p && { code: p.code, label: p.label, sayAs: p.sayAs, kind: p.kind };
          },
          soundForLabel: soundLabelLookup([...(this.phonemeInfo?.values() ?? [])]),
        };
        expanded = expandTemplate(template, params as Record<string, unknown>, ctx);
      } else {
        const raw = input as Extract<QuestionInput, { type: string }>;
        expanded = { ...raw, type: raw.type || fallbackType };
      }
      // Writing: a rubric named by the question becomes its stored criteria; a handwriting
      // question's glyph must exist.
      let glyphId: string | null = null;
      if (WRITING_QUESTION_TYPES.has(expanded.type)) {
        const refs = this.writingRefs;
        if (!refs) throw new Error("writing references are not loaded");
        expanded.answer = compileWritingAnswer(expanded.type, expanded.answer, refs.rubrics, this.currentLevelRank);
        if (expanded.type === "TRACING") {
          const glyphCode = String(expanded.content.glyph ?? "");
          glyphId = refs.glyphs.get(glyphCode) ?? null;
          if (!glyphId) throw new Error(`unknown glyph "${glyphCode}"`);
        }
      }
      const parsed = parseQuestion(expanded.type, expanded.content, expanded.answer);
      if (!parsed.ok) throw new Error(parsed.error);
      // Sounds are spoken through sound tokens, never as letters a voice would misread.
      const speech = speechProblems(
        expanded.promptSpeech,
        expanded.content,
        this.phonemeInfo ? new Set(this.phonemeInfo.keys()) : undefined,
      );
      if (speech.length) throw new Error(`speech: ${speech.join("; ")}`);
      // A word in a pattern's question must really use that pattern (its sound), not just
      // contain the letters: "ship" for SH, not "mishap".
      if (expanded.pattern && expanded.word) {
        const w = this.wordBank.get(normalizeWord(expanded.word));
        const patternCode = expanded.pattern.toUpperCase();
        const pattern = this.patternBank.get(patternCode);
        const types = new Map([...this.patternBank.values()].map((p) => [p.code, { type: p.type }]));
        if (w?.segments?.length && pattern && !segmentsUsePattern(w.segments, pattern, types))
          this.flag({
            entity: "question",
            entity_key: code,
            rule: "word_not_using_pattern",
            severity: "warning",
            message: `"${w.word}" is used for ${patternCode} but its split does not use ${patternCode}`,
          });
      }
      return {
        code,
        activity_id: activityId,
        question_type: expanded.type,
        skill_id: input.skill ? this.lookup("skills", input.skill, "skill") : skillId,
        prompt: expanded.prompt,
        prompt_speech: expanded.promptSpeech,
        content: expanded.content,
        answer: expanded.answer,
        explanation: String(input.explanation ?? ""),
        metadata: {
          ...("metadata" in input && input.metadata ? input.metadata : {}),
          ...(expanded.area ? { wordArea: expanded.area } : {}),
          ...(expanded.spellingActivity ? { spellingActivity: expanded.spellingActivity } : {}),
        },
        sentence_id: expanded.sentence ? (this.idMap("sentences").get(expanded.sentence) ?? null) : null,
        word_id: expanded.word ? this.lookup("words", `${normalizeWord(expanded.word)}|1`, "word") : null,
        phonics_pattern_id: expanded.pattern
          ? this.lookup("phonics_patterns", expanded.pattern.toUpperCase(), "phonics pattern")
          : null,
        story_id: expanded.story ? this.lookup("stories", expanded.story, "story") : null,
        glyph_id: glyphId,
        difficulty: input.difficulty ?? 1,
        status: "published",
      };
    } catch (error) {
      report.invalid++;
      const message =
        error instanceof TemplateError || error instanceof Error ? error.message : String(error);
      report.errors.push(`question ${code}: ${message}`);
      return null;
    }
  }

  // Writing skills, reference handwriting and rubric templates. A glyph whose strokes are
  // malformed (or whose character does not match its kind and case) is rejected; doubts
  // (a first stroke that starts at the bottom, a very loose tolerance) are flagged.
  async importWriting(file: WritingFile) {
    const ranks = (await this.loadVocabularyRefs()).levelRanks;
    const rank = (code: string, what: string) => {
      const r = ranks.get(code);
      if (r === undefined) throw new Error(`${what}: unknown level "${code}"`);
      return r;
    };
    this.flagScopes.add("glyph");
    this.flagScopes.add("writing_rubric");

    const skillReport = this.entity("writing skills");
    const skillRows: Row[] = [];
    const skills = new Map<string, { minRank: number; maxRank: number }>();
    for (const sk of file.writingSkills) {
      try {
        const [minRank, maxRank] = [rank(sk.minLevel, sk.code), rank(sk.maxLevel, sk.code)];
        if (minRank > maxRank) throw new Error(`${sk.code}: ${sk.minLevel} is after ${sk.maxLevel}`);
        skills.set(sk.code, { minRank, maxRank });
        skillRows.push({
          code: sk.code,
          name: sk.name,
          child_name: sk.childName,
          description: sk.description,
          strand: sk.strand,
          min_level_rank: minRank,
          max_level_rank: maxRank,
          emoji: sk.emoji,
          sort_order: sk.sortOrder,
          status: sk.status,
        });
      } catch (error) {
        skillReport.invalid++;
        skillReport.errors.push((error as Error).message);
      }
    }
    await this.sync("writing_skill_types", "writing skills", ["code"], skillRows);

    const glyphReport = this.entity("glyphs");
    const glyphRows: Row[] = [];
    for (const g of file.glyphs) {
      const { errors, warnings } = glyphProblems(g);
      if (errors.length > 0) {
        glyphReport.invalid++;
        glyphReport.errors.push(`glyph ${g.code}: ${errors.join("; ")}`);
        continue;
      }
      for (const message of warnings)
        this.flag({ entity: "glyph", entity_key: g.code, rule: "glyph_check", severity: "warning", message });
      glyphRows.push({
        code: g.code,
        kind: g.kind,
        character: g.character,
        letter_case: g.case,
        script: g.script,
        name: g.name,
        strokes: g.strokes,
        guide: g.guide,
        tolerance: g.tolerance,
        completion: g.completion,
        difficulty: g.difficulty,
        family: g.family,
        formation_tip: g.formationTip,
        formation_speech: g.formationSpeech,
        sort_order: g.sortOrder,
        status: g.status,
      });
    }
    const glyphIds = await this.sync("handwriting_glyphs", "glyphs", ["code"], glyphRows);

    const rubricReport = this.entity("writing rubrics");
    const rubricRows: Row[] = [];
    const rubrics = new Map<string, RubricTemplate & { minRank: number; maxRank: number }>();
    for (const r of file.rubrics) {
      try {
        const [minRank, maxRank] = [rank(r.minLevel, r.code), rank(r.maxLevel, r.code)];
        if (minRank > maxRank) throw new Error(`${r.code}: ${r.minLevel} is after ${r.maxLevel}`);
        if (!r.criteria.some((c) => c.critical === true || c.critical === "level") && !r.ideas?.critical && !r.topic?.critical)
          throw new Error(`${r.code}: a rubric needs at least one critical criterion`);
        const ids = r.criteria.map((c) => c.id);
        if (new Set(ids).size !== ids.length) throw new Error(`${r.code}: criterion ids must be unique`);
        rubrics.set(r.code, { ...r, minRank, maxRank });
        rubricRows.push({
          code: r.code,
          name: r.name,
          description: r.description,
          min_level_rank: minRank,
          max_level_rank: maxRank,
          criteria: r.criteria,
          status: r.status,
        });
      } catch (error) {
        rubricReport.invalid++;
        rubricReport.errors.push((error as Error).message);
      }
    }
    await this.sync("writing_rubrics", "writing rubrics", ["code"], rubricRows);

    this.writingRefs = {
      skills,
      glyphs: new Map(glyphRows.map((g) => [String(g.code), glyphIds.get(String(g.code))!])),
      rubrics,
    };
  }

  // Writing references from the database (when the writing file is not part of this run).
  // Rubric templates are only in the file: a run without it cannot compile rubric answers.
  private async loadWritingRefs(): Promise<WritingRefs> {
    if (this.writingRefs) return this.writingRefs;
    const [skills, glyphs] = await Promise.all([
      fetchAll(this.db, "writing_skill_types", "code,min_level_rank,max_level_rank"),
      fetchAll(this.db, "handwriting_glyphs", "id,code", [{ op: "neq", column: "status", value: "archived" }]),
    ]);
    this.writingRefs = {
      skills: new Map(skills.map((r) => [String(r.code), { minRank: Number(r.min_level_rank), maxRank: Number(r.max_level_rank) }])),
      glyphs: new Map(glyphs.map((r) => [String(r.code), String(r.id)])),
      rubrics: new Map(),
    };
    return this.writingRefs;
  }

  async importCurriculum(file: CurriculumFile) {
    await Promise.all([
      this.loadIds("levels", ["code"]),
      this.loadIds("subjects", ["code"]),
      this.loadIds("phonics_patterns", ["code"]),
      this.loadIds("words", ["normalized_word", "sense"]),
      this.loadIds("stories", ["code"]),
      this.loadIds("skills", ["code"]),
      this.loadIds("lessons", ["code"]),
      this.loadIds("phonics_stages", ["code"]),
      this.loadIds("sentences", ["text"]),
    ]);
    await this.loadBanksFromDatabase();
    this.flagScopes.add("question");
    const levelId = this.lookup("levels", file.level, "level");
    this.currentLevelRank = (await this.loadVocabularyRefs()).levelRanks.get(file.level);
    const spellingRules = (await this.rules()).spelling;
    this.currentSpellingLevel = spellingRules.levels[file.level] ?? spellingRules.levels[spellingRules.defaultLevel];

    // Reading skills of this level: reading skill → the skill (code) tagged with it. A skill
    // may only teach a reading skill taught at this level (no inference in KG1).
    const readingRules = (await this.rules()).reading;
    const readingLevel = readingRules.levels[file.level] ?? readingRules.levels[readingRules.defaultLevel];
    const readingSkills = new Map<string, string>();
    const readingRefs = await this.loadReadingRefs();
    for (const unit of file.units)
      for (const skill of unit.skills) {
        if (!skill.readingSkill) continue;
        const minRank = readingRefs.skills.get(skill.readingSkill);
        const report = this.entity("skills");
        if (minRank === undefined) {
          report.errors.push(`skill ${skill.code}: unknown reading skill "${skill.readingSkill}"`);
          report.invalid++;
          skill.readingSkill = undefined;
        } else if (this.currentLevelRank !== undefined && minRank > this.currentLevelRank) {
          report.errors.push(`skill ${skill.code}: ${skill.readingSkill} is not taught at ${file.level}`);
          report.invalid++;
          skill.readingSkill = undefined;
        } else if (!readingSkills.has(skill.readingSkill)) readingSkills.set(skill.readingSkill, skill.code);
      }

    // Writing skills: a skill may only teach a writing skill taught at this level (no
    // paragraph writing in KG1).
    const writingRefs = await this.loadWritingRefs();
    for (const unit of file.units)
      for (const skill of unit.skills) {
        if (!skill.writingSkill) continue;
        const range = writingRefs.skills.get(skill.writingSkill);
        const report = this.entity("skills");
        if (!range) {
          report.errors.push(`skill ${skill.code}: unknown writing skill "${skill.writingSkill}"`);
          report.invalid++;
          skill.writingSkill = undefined;
        } else if (
          this.currentLevelRank !== undefined &&
          (this.currentLevelRank < range.minRank || this.currentLevelRank > range.maxRank)
        ) {
          report.errors.push(`skill ${skill.code}: ${skill.writingSkill} is not taught at ${file.level}`);
          report.invalid++;
          skill.writingSkill = undefined;
        }
      }

    // Lessons written as a blueprint become ordinary activities here, before anything else
    // sees them (src/lib/content/lesson-blueprints.ts).
    for (const unit of file.units) {
      for (const skill of unit.skills) {
        skill.lessons = skill.lessons.filter((lesson) => {
          if (!lesson.blueprint) return true;
          try {
            const storyCode = typeof lesson.blueprint.story === "string" ? lesson.blueprint.story : null;
            const story = storyCode ? this.storyBank.get(storyCode) : undefined;
            if (story && story.levelCode !== file.level)
              throw new BlueprintError(`story ${storyCode} is a ${story.levelCode} text, not ${file.level}`);
            lesson.activities = expandBlueprint({
              levelRank: this.currentLevelRank,
              spellingLevel: this.currentSpellingLevel,
              ...lesson.blueprint,
              ...(lesson.blueprint.name === "reading"
                ? {
                    storyData: story?.input,
                    readingSkills,
                    readingLevel,
                    patternWords: story?.patternWords,
                  }
                : {}),
            }).map((a) => ({
              ...a,
              config: a.config ?? {},
              status: lesson.status,
              questions: a.questions.map((q) => ({ difficulty: 1, explanation: "", ...q }) as QuestionInput),
            }));
            return true;
          } catch (error) {
            const report = this.entity("lessons");
            report.invalid++;
            report.errors.push(
              `lesson ${lesson.code}: ${error instanceof BlueprintError ? error.message : String(error)}`,
            );
            return false;
          }
        });
      }
    }

    const unitIds = await this.sync(
      "units",
      "units",
      ["code"],
      file.units.map((u, i) => ({
        code: u.code,
        level_id: levelId,
        subject_id: this.lookup("subjects", u.subject, "subject"),
        title: u.title,
        description: u.description,
        emoji: u.emoji,
        sort_order: i,
        status: u.status,
      })),
    );

    const skills = file.units.flatMap((u) => u.skills.map((s, i) => ({ unit: u, skill: s, order: i })));
    const skillIds = await this.sync(
      "skills",
      "skills",
      ["code"],
      skills.map(({ unit, skill, order }) => ({
        code: skill.code,
        unit_id: unitIds.get(unit.code),
        dimension_code: skill.dimension,
        title: skill.title,
        child_title: skill.childTitle,
        description: skill.description,
        phonics_pattern_id: skill.pattern
          ? this.lookup("phonics_patterns", skill.pattern, "phonics pattern")
          : null,
        mastery_threshold: skill.masteryThreshold,
        importance: skill.importance,
        difficulty: skill.difficulty,
        is_active: skill.active,
        reading_skill_code: skill.readingSkill ?? null,
        writing_skill_code: skill.writingSkill ?? null,
        phonics_stage_code: skill.phonicsStage
          ? (this.lookup("phonics_stages", skill.phonicsStage, "phonics stage"), skill.phonicsStage)
          : null,
        sort_order: order,
        status: skill.status,
      })),
    );

    const prereqs: Row[] = [];
    for (const { skill } of skills) {
      for (const p of skill.prerequisites) {
        const prerequisiteId = skillIds.get(p) ?? this.idMap("skills").get(p);
        if (!prerequisiteId) {
          this.entity("skills").errors.push(
            `skill ${skill.code}: prerequisite "${p}" not found (import its level first)`,
          );
          continue;
        }
        prereqs.push({ skill_id: skillIds.get(skill.code), prerequisite_skill_id: prerequisiteId });
      }
    }
    await this.syncLinks(
      "skill_prerequisites",
      "skill_id",
      skills.map(({ skill }) => skillIds.get(skill.code)!),
      prereqs,
      ["skill_id", "prerequisite_skill_id"],
    );

    const lessons = skills.flatMap(({ skill }) =>
      skill.lessons.map((l, i) => ({ skill, lesson: l, order: i })),
    );
    const lessonIds = await this.sync(
      "lessons",
      "lessons",
      ["code"],
      lessons.map(({ skill, lesson, order }) => ({
        code: lesson.code,
        skill_id: skillIds.get(skill.code),
        title: lesson.title,
        child_title: lesson.childTitle,
        description: lesson.description,
        emoji: lesson.emoji,
        sort_order: order,
        estimated_minutes: lesson.minutes,
        difficulty: lesson.difficulty,
        intro_speech: lesson.introSpeech,
        status: lesson.status,
      })),
    );

    const lessonPrereqs: Row[] = [];
    for (const { lesson } of lessons) {
      for (const p of lesson.prerequisites) {
        const prerequisiteId = lessonIds.get(p) ?? this.idMap("lessons").get(p);
        if (!prerequisiteId) {
          this.entity("lessons").errors.push(
            `lesson ${lesson.code}: prerequisite "${p}" not found (import its level first)`,
          );
          continue;
        }
        lessonPrereqs.push({ lesson_id: lessonIds.get(lesson.code), prerequisite_lesson_id: prerequisiteId });
      }
    }
    await this.syncLinks(
      "lesson_prerequisites",
      "lesson_id",
      lessons.map(({ lesson }) => lessonIds.get(lesson.code)!),
      lessonPrereqs,
      ["lesson_id", "prerequisite_lesson_id"],
    );
    await this.archiveMissing(
      "lessons",
      "lessons",
      "skill_id",
      skills.map(({ skill }) => skillIds.get(skill.code)!),
      new Set(lessons.map(({ lesson }) => lessonIds.get(lesson.code)!)),
    );

    // An activity whose configuration does not match its type's schema is rejected
    // (and, if it was imported before, archived by archiveMissing below).
    const activities = lessons
      .flatMap(({ skill, lesson }) =>
        lesson.activities.map((a, i) => ({
          skill,
          lesson,
          activity: a,
          order: i,
          code: a.code ?? `${lesson.code}-a${i + 1}`,
        })),
      )
      .filter(({ activity, code }) => {
        const config = parseActivityConfig(activity.type, activity.config);
        if (config.ok) return true;
        const report = this.entity("activities");
        report.invalid++;
        report.errors.push(`activity ${code}: config ${config.error}`);
        return false;
      });
    const activityIds = await this.sync(
      "activities",
      "activities",
      ["code"],
      activities.map(({ lesson, activity, order, code }) => ({
        code,
        lesson_id: lessonIds.get(lesson.code),
        activity_type: activity.type,
        stage: activity.stage,
        title: activity.title,
        instructions: activity.instructions,
        instructions_speech: activity.instructionsSpeech,
        config: activity.config,
        sort_order: order,
        status: activity.status,
      })),
    );
    await this.archiveMissing(
      "activities",
      "activities",
      "lesson_id",
      lessons.map(({ lesson }) => lessonIds.get(lesson.code)!),
      new Set(activities.map((a) => activityIds.get(a.code)!)),
    );

    const questionRows: Row[] = [];
    for (const { skill, activity, code } of activities) {
      activity.questions.forEach((q, i) => {
        const row = this.buildQuestion(
          q,
          q.code ?? `${code}-q${i + 1}`,
          skillIds.get(skill.code)!,
          activityIds.get(code)!,
          activity.type,
        );
        if (row) questionRows.push({ ...row, sort_order: i });
      });
    }
    const questionIds = await this.sync("questions", "questions", ["code"], questionRows);
    await this.archiveMissing(
      "questions",
      "questions",
      "activity_id",
      activities.map((a) => activityIds.get(a.code)!),
      new Set(questionRows.map((q) => questionIds.get(String(q.code))!)),
    );
  }

  async importAssessments(file: z.infer<typeof assessmentsFileSchema>) {
    await Promise.all([
      this.loadIds("levels", ["code"]),
      this.loadIds("skills", ["code"]),
      this.loadIds("phonics_patterns", ["code"]),
      this.loadIds("words", ["normalized_word", "sense"]),
      this.loadIds("stories", ["code"]),
      this.loadIds("sentences", ["text"]),
    ]);
    await this.loadBanksFromDatabase();
    await this.loadWritingRefs();
    this.currentLevelRank = undefined;
    const report = this.entity("assessments");
    const rows: Row[] = [];
    for (const a of file.assessments) {
      try {
        rows.push({
          code: a.code,
          title: a.title,
          description: a.description,
          assessment_type: a.type,
          level_id: a.level ? this.lookup("levels", a.level, "level") : null,
          config: a.config,
          status: a.status,
        });
      } catch (error) {
        report.invalid++;
        report.errors.push(`assessment ${a.code}: ${(error as Error).message}`);
      }
    }
    const assessmentIds = await this.sync("assessments", "assessments", ["code"], rows);

    const questionRows: Row[] = [];
    const itemRows: {
      assessmentCode: string;
      questionCode: string;
      stage: number;
      label: string;
      order: number;
    }[] = [];
    for (const a of file.assessments.filter((x) => assessmentIds.has(x.code))) {
      let order = 0;
      for (const stage of a.stages) {
        let skillId: string;
        try {
          skillId = this.lookup("skills", stage.skill, "skill");
        } catch (error) {
          report.errors.push(`assessment ${a.code} stage ${stage.stage}: ${(error as Error).message}`);
          continue;
        }
        stage.questions.forEach((q, i) => {
          const code = q.code ?? `${a.code}-s${stage.stage}-q${i + 1}`;
          const row = this.buildQuestion(q, code, skillId, null, "MULTIPLE_CHOICE");
          if (!row) return;
          questionRows.push({ ...row, sort_order: order });
          itemRows.push({
            assessmentCode: a.code,
            questionCode: code,
            stage: stage.stage,
            label: stage.label,
            order: order++,
          });
        });
      }
    }
    const questionIds = await this.sync("questions", "questions", ["code"], questionRows);
    const items = itemRows.map((i) => ({
      assessment_id: assessmentIds.get(i.assessmentCode),
      question_id: questionIds.get(i.questionCode),
      stage: i.stage,
      stage_label: i.label,
      sort_order: i.order,
    }));
    await this.syncLinks("assessment_items", "assessment_id", [...assessmentIds.values()], items, [
      "assessment_id",
      "question_id",
    ]);
  }

  // Replaces the review flags of every kind of content this run checked.
  // Spelling targets, step 1: every row must name a word of the bank (spelling data never
  // creates or copies a word), a known level, spelling type and pattern, and an irregular
  // part that is in the word. Doubtful rows are flagged: a focus pattern the word's split
  // does not use, a type or length outside the level's spelling progression, a sentence
  // without the word. Dictation sentences go into the sentence bank. The spelling facts
  // are attached to the word bank for the templates.
  async prepareSpelling(words: SpellingWordInput[]) {
    await Promise.all([
      this.loadIds("words", ["normalized_word", "sense"]),
      this.loadIds("levels", ["code"]),
      this.loadIds("phonics_patterns", ["code"]),
      this.loadIds("spelling_types", ["code"]),
      this.loadIds("audio_assets", ["storage_path"]),
      this.loadIds("sentences", ["text"]),
    ]);
    await this.loadBanksFromDatabase();
    const rules = (await this.rules()).spelling;
    const types = new Map([...this.patternBank.values()].map((p) => [p.code, { type: p.type }]));
    this.flagScopes.add("spelling_word");
    const report = this.entity("spelling words");
    const seen = new Set<string>();
    const sentences = new Map<string, Row>();
    words.forEach((s, index) => {
      const key = `${normalizeWord(s.word)}|${s.sense}`;
      try {
        if (seen.has(key)) {
          report.duplicate++;
          report.errors.push(`spelling word "${s.word}" appears more than once; kept the first`);
          return;
        }
        seen.add(key);
        const wordId = this.idMap("words").get(key);
        const bankWord = this.wordBank.get(normalizeWord(s.word));
        if (!wordId || !bankWord) throw new Error("is not in the word bank (add it to content/words first)");
        const levelId = this.lookup("levels", s.level, "level");
        this.lookup("spelling_types", s.spellingType, "spelling type");
        const segments = bankWord.segments ?? [];
        const positions = irregularPositions(s.word, segments, s.irregularPart);
        if (s.phonicsPattern) {
          this.lookup("phonics_patterns", s.phonicsPattern, "phonics pattern");
          const pattern = this.patternBank.get(s.phonicsPattern);
          if (segments.length && pattern && !segmentsUsePattern(segments, pattern, types))
            this.flag({
              entity: "spelling_word",
              entity_key: s.word,
              rule: "word_not_using_pattern",
              severity: "warning",
              message: `"${s.word}" is a spelling word for ${s.phonicsPattern} but its split does not use it`,
            });
        }
        const level = rules.levels[s.level];
        if (level && !level.spellingTypes.includes(s.spellingType))
          this.flag({
            entity: "spelling_word",
            entity_key: s.word,
            rule: "spelling_progression",
            severity: "warning",
            message: `${s.spellingType} is not in ${s.level}'s spelling progression (${level.spellingTypes.join(", ")})`,
          });
        if (level && s.word.length > level.maxWordLength)
          this.flag({
            entity: "spelling_word",
            entity_key: s.word,
            rule: "spelling_progression",
            severity: "warning",
            message: `"${s.word}" is longer than ${s.level}'s ${level.maxWordLength} letters`,
          });
        if (s.exampleSentence) {
          if (!findWordInSentence(s.exampleSentence, s.word))
            this.flag({
              entity: "spelling_word",
              entity_key: s.word,
              rule: "example_sentence",
              severity: "warning",
              message: `"${s.exampleSentence}" does not use "${s.word}"`,
            });
          if (!sentences.has(s.exampleSentence))
            sentences.set(s.exampleSentence, {
              text: s.exampleSentence,
              level_id: levelId,
              difficulty: s.difficulty,
              grammar_complexity: 1,
              word_count: s.exampleSentence.split(/\s+/).length,
              status: "published",
            });
        }
        bankWord.spelling = templateSpellingFromInput(s, segments);
        this.pendingSpelling.push({
          input: s,
          row: {
            word_id: wordId,
            level_id: levelId,
            spelling_type_code: s.spellingType,
            phonics_pattern_id: s.phonicsPattern ? this.lookup("phonics_patterns", s.phonicsPattern, "phonics pattern") : null,
            difficulty: s.difficulty,
            is_high_frequency: s.isHighFrequency,
            is_irregular: s.isIrregular,
            irregular_part: s.irregularPart ?? "",
            irregular_positions: positions,
            hints: s.hints.map((text) => ({ text })),
            common_errors: s.commonErrors.map((spelling) => ({ spelling })),
            audio_asset_id: s.audio ? this.lookup("audio_assets", s.audio, "audio recording") : null,
            tags: s.tags,
            sort_order: index,
            status: s.status,
          },
        });
      } catch (error) {
        report.invalid++;
        report.errors.push(`spelling word "${s.word}": ${(error as Error).message}`);
      }
    });
    // Only sentences not already in the bank are added (existing rows are left as they are).
    const fresh = [...sentences.values()].filter((r) => !this.idMap("sentences").has(String(r.text)));
    if (fresh.length > 0) await this.sync("sentences", "example sentences", ["text"], fresh);
  }

  // Spelling targets, step 2 (after the curriculum, so skills exist): write the rows and, for
  // a full import, archive published spelling targets that are no longer in the files.
  async importSpellingWords(archiveMissing: boolean) {
    await Promise.all([this.loadIds("skills", ["code"]), this.loadIds("sentences", ["text"])]);
    const report = this.entity("spelling words");
    const rows: Row[] = [];
    for (const { input, row } of this.pendingSpelling) {
      try {
        rows.push({
          ...row,
          skill_id: input.skill ? this.lookup("skills", input.skill, "skill") : null,
          sentence_id: input.exampleSentence ? (this.idMap("sentences").get(input.exampleSentence) ?? null) : null,
        });
      } catch (error) {
        report.invalid++;
        report.errors.push(`spelling word "${input.word}": ${(error as Error).message}`);
      }
    }
    const ids = await this.sync("spelling_words", "spelling words", ["word_id"], rows);
    if (!archiveMissing) {
      this.pendingSpelling = [];
      return;
    }
    const kept = new Set(rows.map((r) => ids.get(String(r.word_id))).filter(Boolean));
    const existing = await fetchAll(this.db, "spelling_words", "id,status", [
      { op: "neq", column: "status", value: "archived" },
    ]);
    const stale = existing.map((r) => String(r.id)).filter((id) => !kept.has(id));
    report.archived += stale.length;
    if (!this.options.dryRun && stale.length > 0) {
      const { error } = await this.db.from("spelling_words").update({ status: "archived" }).in("id", stale);
      if (error) throw new Error(`archiving spelling_words: ${error.message}`);
    }
    this.pendingSpelling = [];
  }

  async writeFlags() {
    const report = this.entity("review flags");
    const unique = new Map(this.flags.map((f) => [`${f.entity}|${f.entity_key}|${f.rule}`, f]));
    report.added = unique.size;
    if (this.options.dryRun || this.flagScopes.size === 0) return;
    const { error } = await this.db.from("content_flags").delete().in("entity", [...this.flagScopes]);
    if (error) throw new Error(`clearing content_flags: ${error.message}`);
    const rows = [...unique.values()];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const { error: insertError } = await this.db.from("content_flags").insert(rows.slice(i, i + BATCH_SIZE));
      if (insertError) throw new Error(`writing content_flags: ${insertError.message}`);
    }
  }

  async importBundle(bundle: ImportBundle) {
    if (bundle.reference) await this.importReference(bundle.reference);
    if (bundle.phonics) await this.importPhonics(bundle.phonics);
    if (bundle.words) await this.importWords(bundle.words);
    if (bundle.sightWords) await this.importSightWords(bundle.sightWords);
    if (bundle.sentences) {
      for (const s of bundle.sentences.sentences) this.sentenceFileTexts.add(s.text);
      await this.importSentences(bundle.sentences);
    }
    await this.importWordExamples();
    if (bundle.vocabulary) await this.importFamilies(bundle.vocabulary);
    if (bundle.stories) await this.importStories(bundle.stories);
    if (bundle.writing) await this.importWriting(bundle.writing);
    // Spelling targets are checked (and their sentences stored) before the curriculum, whose
    // spelling templates read them; their rows are written after it, once skills exist.
    if (bundle.spelling) await this.prepareSpelling(bundle.spelling);
    for (const file of bundle.curriculum ?? []) await this.importCurriculum(file);
    if (bundle.spelling) await this.importSpellingWords(bundle.spellingComplete === true);
    if (bundle.assessments) await this.importAssessments(bundle.assessments);
    await this.writeFlags();
    return this.report;
  }
}
