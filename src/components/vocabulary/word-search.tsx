import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { PARTS_OF_SPEECH } from "@/lib/content/content-schemas";
import { loadWordFilters, searchWords } from "@/lib/server/vocabulary";
import { wordSearchQuery, type WordSearch } from "@/lib/validation/vocabulary";

// Vocabulary search for grown-ups: start of a word, category, level, difficulty, phonics
// pattern ("which words practise SH?"), shape (CVC…) and part of speech, filtered and
// paginated in the database. Admins also see drafts (RLS) and get links to edit words.

const SHAPES = ["CVC", "CCVC", "CVCC", "CVVC", "CV", "VC"];

export async function WordSearchView({
  basePath,
  search,
  hidden = {},
  admin = false,
}: {
  basePath: string;
  search: WordSearch;
  // Query parameters to keep (e.g. the chosen child).
  hidden?: Record<string, string>;
  admin?: boolean;
}) {
  const [filters, result] = await Promise.all([loadWordFilters(), searchWords(search, { pageSize: 30 })]);
  const link = (page: number) => {
    const qs = wordSearchQuery(search, { page });
    const keep = new URLSearchParams(hidden).toString();
    return `${basePath}?${[keep, qs].filter(Boolean).join("&")}`;
  };
  const select = (
    id: keyof WordSearch,
    label: string,
    options: { value: string; label: string }[],
    all: string,
  ) => (
    <div>
      <label htmlFor={`word-${id}`} className="block text-sm font-semibold">
        {label}
      </label>
      <Select id={`word-${id}`} name={id} defaultValue={String(search[id] ?? "")}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <div className="space-y-4">
      <form role="search" className="flex flex-wrap items-end gap-3" action={basePath}>
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <div>
          <label htmlFor="word-q" className="block text-sm font-semibold">
            Word starts with
          </label>
          <Input id="word-q" name="q" defaultValue={search.q ?? ""} placeholder="ca…" className="w-36" />
        </div>
        {select(
          "category",
          "Category",
          filters.categories.map((c) => ({ value: c.code, label: `${c.emoji} ${c.name}` })),
          "All categories",
        )}
        {select(
          "level",
          "Level",
          filters.levels.map((l) => ({ value: l.code, label: l.name })),
          "All levels",
        )}
        {select(
          "pattern",
          "Phonics pattern",
          filters.patterns.map((p) => ({ value: p.code, label: p.label })),
          "Any pattern",
        )}
        {select(
          "shape",
          "Shape",
          SHAPES.map((s) => ({ value: s, label: s })),
          "Any shape",
        )}
        {select(
          "pos",
          "Part of speech",
          PARTS_OF_SPEECH.map((p) => ({ value: p, label: p })),
          "Any",
        )}
        {select(
          "difficulty",
          "Difficulty",
          Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
          "Any",
        )}
        <button type="submit" className="bg-primary min-h-11 rounded-xl px-5 font-semibold text-white">
          Search
        </button>
        <Link
          href={`${basePath}?${new URLSearchParams(hidden)}`}
          className="text-muted min-h-11 px-2 py-2 font-semibold"
        >
          Clear
        </Link>
      </form>

      {result.words.length === 0 ? (
        <EmptyState icon="🔍" title="No words match">
          Try fewer filters or another spelling.
        </EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left">
            <thead className="bg-surface-muted text-sm">
              <tr>
                <th className="px-4 py-2">Word</th>
                <th className="px-4 py-2">Level</th>
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">Kind</th>
                <th className="px-4 py-2">Difficulty</th>
                {admin ? <th className="px-4 py-2">Status</th> : null}
              </tr>
            </thead>
            <tbody>
              {result.words.map((w) => (
                <tr key={w.id} className="border-border border-t">
                  <td className="px-4 py-2 font-semibold">
                    <span aria-hidden>{w.emoji} </span>
                    {admin ? (
                      <Link href={`/admin/words/${w.id}`} className="underline">
                        {w.word}
                      </Link>
                    ) : (
                      w.word
                    )}
                  </td>
                  <td className="px-4 py-2">{w.level}</td>
                  <td className="px-4 py-2">{w.category ? `${w.categoryEmoji} ${w.category}` : "—"}</td>
                  <td className="px-4 py-2 text-sm">
                    {[w.partOfSpeech, w.shape].filter(Boolean).join(" · ")}
                  </td>
                  <td className="px-4 py-2">{w.difficulty}</td>
                  {admin ? <td className="px-4 py-2 text-sm">{w.status}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <nav aria-label="Pages" className="flex items-center gap-3">
        {result.page > 1 ? <Link href={link(result.page - 1)}>← Previous</Link> : null}
        <span>
          Page {result.page} of {result.pages} ({result.total} words)
        </span>
        {result.page < result.pages ? <Link href={link(result.page + 1)}>Next →</Link> : null}
      </nav>
    </div>
  );
}
