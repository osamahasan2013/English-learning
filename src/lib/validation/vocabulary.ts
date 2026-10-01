import { z } from "zod";
import { PARTS_OF_SPEECH } from "@/lib/content/content-schemas";

// Vocabulary search filters, as they arrive in a page's query string. Anything invalid is
// dropped (the filter is simply not applied) rather than failing the page; the search
// runs in the database with these values only.

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_]{1,40}$/);
const optional = <T extends z.ZodTypeAny>(schema: T) => schema.optional().catch(undefined);

export const wordSearchSchema = z.object({
  // Start of the word, letters/apostrophes/hyphens/spaces only (no wildcards).
  q: optional(
    z
      .string()
      .trim()
      .toLowerCase()
      .max(40)
      .transform((v) => v.replace(/[^a-z' -]/g, ""))
      .pipe(z.string().min(1)),
  ),
  category: optional(code),
  level: optional(code),
  pattern: optional(code),
  pos: optional(z.enum(PARTS_OF_SPEECH)),
  shape: optional(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[CV]{1,10}$/),
  ),
  difficulty: optional(z.coerce.number().int().min(1).max(10)),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});

export type WordSearch = z.infer<typeof wordSearchSchema>;

export function parseWordSearch(params: Record<string, string | string[] | undefined>): WordSearch {
  const flat = Object.fromEntries(
    Object.entries(params)
      .map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
      .filter(([, v]) => v !== ""),
  );
  return wordSearchSchema.parse(flat);
}

// Query string for a search (used by pagination links), without empty values.
export function wordSearchQuery(search: Partial<WordSearch>, overrides: Partial<WordSearch> = {}) {
  const merged = { ...search, ...overrides };
  const entries = Object.entries(merged)
    .filter(([k, v]) => v !== undefined && v !== "" && !(k === "page" && v === 1))
    .map(([k, v]) => [k, String(v)]);
  return new URLSearchParams(entries).toString();
}
