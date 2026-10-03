// Imports curriculum content from /content (or a single words CSV) into Supabase.
//
//   npm run content:import                      # everything in ./content
//   npm run content:import -- --dry-run         # validate + report, write nothing
//   npm run content:import -- --words new.csv   # just a vocabulary CSV
//   npm run content:import -- --spelling new.csv  # just spelling targets (words must exist)
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from .env.local if
// present). Exits non-zero when any file or row is invalid, so CI can gate content.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { z, ZodTypeAny } from "zod";
import {
  assessmentsFileSchema,
  curriculumFileSchema,
  phonicsFileSchema,
  referenceFileSchema,
  sentencesFileSchema,
  sightWordsFileSchema,
  storiesFileSchema,
  vocabularyFileSchema,
} from "@/lib/content/content-schemas";
import { parseSpellingCsv, parseWordsCsv } from "@/lib/content/csv";
import { ContentImporter, type ImportBundle } from "@/lib/content/importer";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const dryRun = flag("--dry-run");
const contentDir = path.resolve(option("--dir") ?? "content");
const wordsOnly = option("--words");
const spellingOnly = option("--spelling");
let fileErrors = 0;
let spellingCsvInvalid = 0;

function readJson<S extends ZodTypeAny>(file: string, schema: S): z.infer<S> | undefined {
  const full = path.join(contentDir, file);
  if (!existsSync(full)) return undefined;
  const parsed = schema.safeParse(JSON.parse(readFileSync(full, "utf8")));
  if (!parsed.success) {
    fileErrors++;
    console.error(`✗ ${file} is invalid and was not imported:`);
    for (const issue of parsed.error.issues.slice(0, 20))
      console.error(`    ${issue.path.join(".")}: ${issue.message}`);
    return undefined;
  }
  return parsed.data;
}

function readWords(file: string) {
  const { rows, missingColumns } = parseWordsCsv(readFileSync(file, "utf8"));
  if (missingColumns.length) {
    fileErrors++;
    console.error(`✗ ${file} is missing required columns: ${missingColumns.join(", ")}`);
    return [];
  }
  const invalid = rows.filter((r) => !r.ok);
  for (const r of invalid) if (!r.ok) console.error(`✗ ${path.basename(file)} line ${r.line}: ${r.error}`);
  fileErrors += invalid.length;
  return rows.flatMap((r) => (r.ok ? [r.word] : []));
}

function readSpelling(file: string) {
  const { rows, missingColumns } = parseSpellingCsv(readFileSync(file, "utf8"));
  if (missingColumns.length) {
    fileErrors++;
    console.error(`✗ ${file} is missing required columns: ${missingColumns.join(", ")}`);
    return [];
  }
  const invalid = rows.filter((r) => !r.ok);
  for (const r of invalid) if (!r.ok) console.error(`✗ ${path.basename(file)} line ${r.line}: ${r.error}`);
  fileErrors += invalid.length;
  spellingCsvInvalid += invalid.length;
  return rows.flatMap((r) => (r.ok ? [r.word] : []));
}

const bundle: ImportBundle = {};
if (wordsOnly) {
  bundle.words = readWords(path.resolve(wordsOnly));
} else if (spellingOnly) {
  bundle.spelling = readSpelling(path.resolve(spellingOnly));
} else {
  bundle.reference = readJson("reference.json", referenceFileSchema);
  bundle.phonics = readJson("phonics.json", phonicsFileSchema);
  const wordsDir = path.join(contentDir, "words");
  if (existsSync(wordsDir)) {
    bundle.words = readdirSync(wordsDir)
      .filter((f) => f.endsWith(".csv"))
      .sort()
      .flatMap((f) => readWords(path.join(wordsDir, f)));
  }
  bundle.sightWords = readJson("sight-words.json", sightWordsFileSchema);
  bundle.sentences = readJson("sentences.json", sentencesFileSchema);
  bundle.vocabulary = readJson("vocabulary.json", vocabularyFileSchema);
  bundle.stories = readJson("stories.json", storiesFileSchema);
  const spellingDir = path.join(contentDir, "spelling");
  if (existsSync(spellingDir)) {
    bundle.spelling = readdirSync(spellingDir)
      .filter((f) => f.endsWith(".csv"))
      .sort()
      .flatMap((f) => readSpelling(path.join(spellingDir, f)));
    bundle.spellingComplete = true;
  }
  const curriculumDir = path.join(contentDir, "curriculum");
  if (existsSync(curriculumDir)) {
    bundle.curriculum = readdirSync(curriculumDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .flatMap((f) => readJson(path.join("curriculum", f), curriculumFileSchema) ?? []);
  }
  bundle.assessments = readJson("assessments.json", assessmentsFileSchema);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(2);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const importer = new ContentImporter(db, { dryRun });

try {
  const report = await importer.importBundle(bundle);
  console.log(dryRun ? "\nDry run — nothing was written.\n" : "\nImport complete.\n");
  console.table(
    Object.fromEntries(
      Object.entries(report).map(([entity, r]) => [
        entity,
        {
          added: r.added,
          updated: r.updated,
          skipped: r.skipped,
          invalid: r.invalid,
          duplicate: r.duplicate,
          archived: r.archived,
        },
      ]),
    ),
  );
  const spelling = report["spelling words"];
  if (spelling) {
    console.log(
      `Spelling words — Created: ${spelling.added}, Updated: ${spelling.updated}, Skipped: ${spelling.skipped}, ` +
        `Invalid: ${spelling.invalid + spellingCsvInvalid}, Duplicates: ${spelling.duplicate}, Archived: ${spelling.archived}`,
    );
  }
  const problems = Object.entries(report).flatMap(([entity, r]) => r.errors.map((e) => `${entity}: ${e}`));
  for (const p of problems) console.warn(`! ${p}`);
  const invalid = Object.values(report).reduce((n, r) => n + r.invalid, 0);
  process.exit(fileErrors + invalid > 0 ? 1 : 0);
} catch (error) {
  console.error(`Import failed: ${(error as Error).message}`);
  process.exit(1);
}
