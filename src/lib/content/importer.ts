import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type {
  assessmentsFileSchema,
  CurriculumFile,
  PhonicsFile,
  QuestionInput,
  ReferenceFile,
  sentencesFileSchema,
  sightWordsFileSchema,
  storiesFileSchema,
  WordInput,
} from "@/lib/content/content-schemas";
import { normalizeWord } from "@/lib/content/csv";
import { parseActivityConfig } from "@/lib/content/activity-config";
import { BlueprintError, expandBlueprint } from "@/lib/content/lesson-blueprints";
import { validatePhonicsFile, type ValidationIssue } from "@/lib/content/phonics-validation";
import { decomposeWord, segmentsUsePattern, type PatternInfo, type PhonemeInfo } from "@/lib/learning/phonics";
import { parseQuestion } from "@/lib/content/question-schemas";
import { mergeLearningRules } from "@/lib/learning/rules";
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

export type ImportBundle = {
  reference?: ReferenceFile;
  phonics?: PhonicsFile;
  words?: WordInput[];
  sightWords?: z.infer<typeof sightWordsFileSchema>;
  sentences?: z.infer<typeof sentencesFileSchema>;
  stories?: z.infer<typeof storiesFileSchema>;
  curriculum?: CurriculumFile[];
  assessments?: z.infer<typeof assessmentsFileSchema>;
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
// Tables whose primary key is their code (no uuid id column).
const CODE_KEYED_TABLES = new Set([
  "skill_dimensions",
  "activity_types",
  "learning_rules",
  "phonemes",
  "phonics_stages",
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
    for (let i = 0; i < realParents.length; i += BATCH_SIZE) {
      const { error } = await this.db
        .from(table)
        .delete()
        .in(parentColumn, realParents.slice(i, i + BATCH_SIZE));
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
    await this.sync(
      "word_categories",
      "word categories",
      ["code"],
      file.wordCategories.map((c) => ({
        code: c.code,
        name: c.name,
        emoji: c.emoji,
        sort_order: c.sortOrder,
      })),
    );
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
        sort_order: i,
        status: f.status,
      })),
    );
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

    await this.sync(
      "phonemes",
      "phonemes",
      ["code"],
      file.phonemes.map((ph, i) => ({
        code: ph.code,
        ipa: ph.ipa,
        label: ph.label,
        say_as: ph.sayAs,
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
    const audioRows = file.patterns
      .filter((p) => p.audio)
      .map((p) => ({
        storage_path: p.audio,
        kind: "phonics",
        tts_text: p.sounds.find((s) => s.primary)?.sayAs ?? p.pattern,
        status: "published",
      }));
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
        { code: ph.code, ipa: ph.ipa, label: ph.label, sayAs: ph.sayAs, kind: ph.kind, voiced: ph.voiced },
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
        sayAs: s.sayAs,
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
          sayAs: s.sayAs,
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
          sayAs: String(ph.say_as),
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
          sayAs: String(s.say_as),
          phonemes: (s.phonemes as string[]) ?? [],
          primary: Boolean(s.is_primary),
        })),
    }));
  }

  async importWords(words: WordInput[]) {
    await Promise.all([
      this.loadIds("levels", ["code"]),
      this.loadIds("word_categories", ["code"]),
      this.loadIds("phonics_patterns", ["code"]),
    ]);
    await this.ensurePhonicsData();
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
        const row = {
          word: w.word,
          normalized_word: normalizeWord(w.word),
          sense: w.sense,
          level_id: this.lookup("levels", w.level, "level"),
          category_id: w.category ? this.lookup("word_categories", w.category, "category") : null,
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
          tags: w.tags,
          emoji: w.emoji,
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

    // Related words, once every word exists.
    const relations: Row[] = [];
    for (const w of valid) {
      for (const related of w.related) {
        const relatedId = wordIds.get(`${normalizeWord(related)}|1`);
        if (!relatedId) {
          report.errors.push(`word "${w.word}": related word "${related}" is not in the word bank`);
          continue;
        }
        relations.push({ word_id: idOf(w), related_word_id: relatedId, relation_type: "related" });
      }
    }
    await this.syncLinks("word_relations", "word_id", valid.map((w) => idOf(w)!).filter(Boolean), relations, [
      "word_id",
      "related_word_id",
      "relation_type",
    ]);

    for (const w of valid) {
      this.wordBank.set(normalizeWord(w.word), {
        word: w.word,
        emoji: w.emoji,
        childDefinition: w.childDefinition,
        patterns: w.patterns.map((p) => ({ code: p.code, sound: p.sound })),
        segments: (splits.get(normalizeWord(w.word))?.segments ?? []).map((seg) => ({
          grapheme: seg.grapheme,
          patternCode: seg.patternCode,
          sayAs: seg.sayAs || this.phonemeSpeech(seg.phonemes),
          phonemes: seg.phonemes,
        })),
      });
    }
  }

  private phonemeSpeech(phonemes: string[]) {
    return phonemes.map((c) => this.phonemeInfo?.get(c)?.sayAs ?? c.toLowerCase()).join(" ");
  }

  // Loads the word bank and patterns from the database, for imports that only contain
  // curriculum files (templates still need them).
  async loadBanksFromDatabase() {
    await this.ensurePhonicsData();
    if (this.wordBank.size === 0) {
      const [words, links, patterns, sounds, segments] = await Promise.all([
        fetchAll(this.db, "words", "id,word,emoji,child_definition,sense"),
        fetchAll(this.db, "word_phonics_patterns", "word_id,pattern_id,sound_id"),
        fetchAll(this.db, "phonics_patterns", "id,code"),
        fetchAll(this.db, "phonics_pattern_sounds", "id,code,say_as"),
        fetchAll(this.db, "word_segments", "word_id,position,grapheme,pattern_id,sound_id,phonemes"),
      ]);
      const patternCode = new Map(patterns.map((p) => [p.id, String(p.code)]));
      const soundById = new Map(sounds.map((s) => [s.id, s]));
      for (const w of words.filter((w) => w.sense === 1)) {
        this.wordBank.set(normalizeWord(String(w.word)), {
          word: String(w.word),
          emoji: String(w.emoji),
          childDefinition: String(w.child_definition),
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
              const sound = seg.sound_id ? soundById.get(seg.sound_id) : undefined;
              return {
                grapheme: String(seg.grapheme),
                patternCode: seg.pattern_id ? (patternCode.get(seg.pattern_id) ?? null) : null,
                sayAs: phonemes.length === 0 ? "" : sound ? String(sound.say_as) : this.phonemeSpeech(phonemes),
                phonemes,
              };
            }),
        });
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
              sayAs: String(s.say_as),
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
      const tokens = new Set(
        s.text
          .split(/\s+/)
          .map((t) => normalizeWord(t.replace(/[^\p{L}\p{N}']/gu, "")))
          .filter(Boolean),
      );
      for (const token of tokens) {
        const wordId = this.idMap("words").get(`${token}|1`);
        if (wordId) wordLinks.push({ sentence_id: sentenceId, word_id: wordId });
      }
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

  async importStories(file: z.infer<typeof storiesFileSchema>) {
    await this.loadIds("levels", ["code"]);
    const report = this.entity("stories");
    const rows: Row[] = [];
    for (const s of file.stories) {
      try {
        rows.push({
          code: s.code,
          title: s.title,
          level_id: this.lookup("levels", s.level, "level"),
          difficulty: s.difficulty,
          summary: s.summary,
          cover_emoji: s.coverEmoji,
          pages: s.pages,
          word_count: s.pages.reduce((n, p) => n + p.text.split(/\s+/).length, 0),
          is_original: s.isOriginal,
          license: s.license,
          status: s.status,
        });
      } catch (error) {
        report.invalid++;
        report.errors.push(`story ${s.code}: ${(error as Error).message}`);
      }
    }
    await this.sync("stories", "stories", ["code"], rows);
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
          pattern: (patternCode) => this.patternBank.get(patternCode),
          phoneme: (phonemeCode) => {
            const p = this.phonemeInfo?.get(phonemeCode);
            return p && { code: p.code, label: p.label, sayAs: p.sayAs, kind: p.kind };
          },
        };
        expanded = expandTemplate(template, params as Record<string, unknown>, ctx);
      } else {
        const raw = input as Extract<QuestionInput, { type: string }>;
        expanded = { ...raw, type: raw.type || fallbackType };
      }
      const parsed = parseQuestion(expanded.type, expanded.content, expanded.answer);
      if (!parsed.ok) throw new Error(parsed.error);
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
        metadata: "metadata" in input && input.metadata ? input.metadata : {},
        word_id: expanded.word ? this.lookup("words", `${normalizeWord(expanded.word)}|1`, "word") : null,
        phonics_pattern_id: expanded.pattern
          ? this.lookup("phonics_patterns", expanded.pattern.toUpperCase(), "phonics pattern")
          : null,
        story_id: expanded.story ? this.lookup("stories", expanded.story, "story") : null,
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
    ]);
    await this.loadBanksFromDatabase();
    this.flagScopes.add("question");
    const levelId = this.lookup("levels", file.level, "level");

    // Lessons written as a blueprint become ordinary activities here, before anything else
    // sees them (src/lib/content/lesson-blueprints.ts).
    for (const unit of file.units) {
      for (const skill of unit.skills) {
        skill.lessons = skill.lessons.filter((lesson) => {
          if (!lesson.blueprint) return true;
          try {
            lesson.activities = expandBlueprint(lesson.blueprint).map((a) => ({
              ...a,
              config: {},
              status: lesson.status,
              questions: a.questions.map((q) => ({ difficulty: 1, explanation: "", ...q })),
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
    ]);
    await this.loadBanksFromDatabase();
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
    if (bundle.sentences) await this.importSentences(bundle.sentences);
    if (bundle.stories) await this.importStories(bundle.stories);
    for (const file of bundle.curriculum ?? []) await this.importCurriculum(file);
    if (bundle.assessments) await this.importAssessments(bundle.assessments);
    await this.writeFlags();
    return this.report;
  }
}
