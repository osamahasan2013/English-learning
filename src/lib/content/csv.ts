import { wordSchema, type WordInput } from "@/lib/content/content-schemas";

// RFC 4180 CSV parsing (quoted fields, escaped quotes, CRLF/LF, embedded newlines) and
// the words.csv row format. Kept dependency-free; imports are small enough to parse in
// memory (a 10,000-word file is well under a megabyte).

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

export const WORD_CSV_REQUIRED_COLUMNS = [
  "word",
  "level",
  "category",
  "difficulty",
  "phonics_pattern",
  "definition",
  "example_sentence",
  "sight_word",
] as const;

export type WordCsvRowResult =
  { ok: true; line: number; word: WordInput } | { ok: false; line: number; raw: string; error: string };

const truthy = (v: string | undefined) => /^(1|true|yes|y)$/i.test((v ?? "").trim());
const list = (v: string | undefined) =>
  (v ?? "")
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);

// phonics_pattern cell: "SH*;EE" or "TH:TH_VOICED*" — code, optional :SOUND, * = featured
// example of that pattern.
export function parsePatternCell(cell: string | undefined) {
  return list(cell).map((entry) => {
    const example = entry.endsWith("*");
    const [patternCode, sound] = entry.replace(/\*$/, "").split(":");
    return { code: patternCode.toUpperCase(), sound: sound?.toUpperCase(), example };
  });
}

export function parseWordsCsv(input: string): {
  header: string[];
  rows: WordCsvRowResult[];
  missingColumns: string[];
} {
  const [headerRow, ...dataRows] = parseCsv(input);
  const header = (headerRow ?? []).map((h) => h.trim().toLowerCase());
  const missingColumns = WORD_CSV_REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missingColumns.length > 0) return { header, rows: [], missingColumns };

  const rows = dataRows.map((cells, i): WordCsvRowResult => {
    const line = i + 2;
    const get = (name: string) => {
      const index = header.indexOf(name);
      return index === -1 ? undefined : cells[index]?.trim();
    };
    const candidate = {
      word: get("word"),
      sense: get("sense") ? Number(get("sense")) : undefined,
      level: get("level")?.toUpperCase(),
      category: get("category") ? get("category")!.toUpperCase() : undefined,
      difficulty: Number(get("difficulty")),
      partOfSpeech: get("part_of_speech") || undefined,
      syllables: get("syllables") ? Number(get("syllables")) : undefined,
      pronunciation: get("pronunciation") || undefined,
      definition: get("definition") || undefined,
      childDefinition: get("child_definition") || undefined,
      exampleSentence: get("example_sentence") || undefined,
      sightWord: truthy(get("sight_word")),
      irregular: truthy(get("irregular")),
      spellingNote: get("spelling_note") || undefined,
      plural: get("plural") || undefined,
      emoji: get("emoji") || undefined,
      tags: list(get("tags")),
      patterns: parsePatternCell(get("phonics_pattern")),
      related: list(get("related")),
      segments: get("segments") || undefined,
      status: get("status") || undefined,
    };
    const parsed = wordSchema.safeParse(candidate);
    if (!parsed.success) {
      return {
        ok: false,
        line,
        raw: cells.join(","),
        error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      };
    }
    return { ok: true, line, word: parsed.data };
  });
  return { header, rows, missingColumns };
}

export function normalizeWord(word: string) {
  return word.normalize("NFKC").trim().toLowerCase();
}
