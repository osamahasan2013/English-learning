import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Words" };

const PAGE_SIZE = 50;

// Server-side search and pagination: the word bank is meant to grow to thousands of
// entries, so it is never loaded into the browser in full.
export default async function AdminWordsPage(props: PageProps<"/admin/words">) {
  const params = await props.searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 40) : "";
  const page = Math.max(1, Number(typeof params.page === "string" ? params.page : 1) || 1);
  const supabase = await createClient();

  let query = supabase
    .from("words")
    .select(
      "id, word, emoji, difficulty, part_of_speech, is_sight_word, is_irregular, status, levels(short_name), word_categories(name)",
      { count: "exact" },
    )
    .order("normalized_word")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) query = query.ilike("normalized_word", `${q.toLowerCase().replace(/[%_\\]/g, "")}%`);
  const { data, count, error } = await query;
  if (error) throw error;
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const link = (p: number) => `/admin/words?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <h1 className="text-3xl font-extrabold">Words</h1>
      <form className="flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          Search words
        </label>
        <Input id="q" name="q" defaultValue={q} placeholder="Starts with…" className="max-w-xs" />
        <button type="submit" className="bg-primary rounded-xl px-4 font-semibold text-white">
          Search
        </button>
      </form>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left">
          <thead className="bg-surface-muted text-sm">
            <tr>
              <th className="px-4 py-2">Word</th>
              <th className="px-4 py-2">Level</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Difficulty</th>
              <th className="px-4 py-2">Flags</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((w) => {
              const level = Array.isArray(w.levels) ? w.levels[0] : w.levels;
              const category = Array.isArray(w.word_categories) ? w.word_categories[0] : w.word_categories;
              return (
                <tr key={w.id} className="border-border border-t">
                  <td className="px-4 py-2 font-semibold">
                    <span aria-hidden>{w.emoji} </span>
                    {w.word}
                  </td>
                  <td className="px-4 py-2">{level?.short_name}</td>
                  <td className="px-4 py-2">{category?.name ?? "—"}</td>
                  <td className="px-4 py-2">{w.difficulty}</td>
                  <td className="px-4 py-2 text-sm">
                    {[w.is_sight_word && "sight word", w.is_irregular && "irregular", w.part_of_speech]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                  <td className="px-4 py-2 text-sm">{w.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <nav aria-label="Pages" className="flex items-center gap-3">
        {page > 1 ? <Link href={link(page - 1)}>← Previous</Link> : null}
        <span>
          Page {page} of {pages} ({count ?? 0} words)
        </span>
        {page < pages ? <Link href={link(page + 1)}>Next →</Link> : null}
      </nav>
    </>
  );
}
