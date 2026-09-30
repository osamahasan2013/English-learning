import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { loadPatternFilters, searchPhonicsPatterns, type PatternSearch } from "@/lib/server/phonics";

// Search and filter phonics patterns (sh, ch, th, CVC letters, long vowels, vowel teams…)
// straight from the database, one page at a time. Used by parents and by content admins
// (who also see drafts, through RLS).

const TYPE_LABELS: Record<string, string> = {
  letter: "Letters",
  consonant_digraph: "Digraphs",
  consonant_blend: "Consonant blends",
  trigraph: "Trigraphs",
  vowel_team: "Vowel teams",
  r_controlled: "R-controlled vowels",
  silent_e: "Magic e (long vowels)",
  word_ending: "Word endings",
  suffix: "Suffixes",
  prefix: "Prefixes",
};

export function readPatternSearch(params: Record<string, string | string[] | undefined>): PatternSearch {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string).slice(0, 40) : undefined);
  return {
    q: one("q"),
    type: one("type"),
    stage: one("stage"),
    level: one("level"),
    page: Number(one("page") ?? 1) || 1,
  };
}

export async function PatternSearchView({
  basePath,
  search,
  showStatus = false,
}: {
  basePath: string;
  search: PatternSearch;
  showStatus?: boolean;
}) {
  const [filters, result] = await Promise.all([loadPatternFilters(), searchPhonicsPatterns(search)]);
  const link = (page: number) => {
    const qs = new URLSearchParams();
    for (const k of ["q", "type", "stage", "level"] as const) if (search[k]) qs.set(k, search[k]!);
    qs.set("page", String(page));
    return `${basePath}?${qs}`;
  };

  return (
    <div className="space-y-4">
      <form role="search" className="flex flex-wrap items-end gap-3" action={basePath}>
        <div>
          <label htmlFor="q" className="block text-sm font-semibold">
            Pattern
          </label>
          <Input id="q" name="q" defaultValue={search.q ?? ""} placeholder="sh, ee, a_e…" className="w-40" />
        </div>
        <div>
          <label htmlFor="type" className="block text-sm font-semibold">
            Type
          </label>
          <Select id="type" name="type" defaultValue={search.type ?? ""}>
            <option value="">All types</option>
            {filters.types.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="stage" className="block text-sm font-semibold">
            Stage
          </label>
          <Select id="stage" name="stage" defaultValue={search.stage ?? ""}>
            <option value="">All stages</option>
            {filters.stages.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="level" className="block text-sm font-semibold">
            Level
          </label>
          <Select id="level" name="level" defaultValue={search.level ?? ""}>
            <option value="">All levels</option>
            {filters.levels.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <button type="submit" className="bg-primary min-h-11 rounded-xl px-5 font-semibold text-white">
          Search
        </button>
        <Link href={basePath} className="text-muted min-h-11 px-2 py-2 font-semibold">
          Clear
        </Link>
      </form>

      {result.patterns.length === 0 ? (
        <EmptyState icon="🔍" title="No patterns match" />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {result.patterns.map((p) => (
            <li key={p.id}>
              <Card className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-2xl font-extrabold">
                    {p.pattern}
                    <span className="text-muted ml-2 text-sm font-semibold">
                      {TYPE_LABELS[p.type] ?? p.type} · {p.level}
                      {p.position !== "any" ? ` · ${p.position}` : ""}
                    </span>
                  </p>
                  {showStatus ? <span className="text-sm">{p.status}</span> : null}
                </div>
                <p>{p.explanation}</p>
                <p className="text-sm">
                  <span className="font-semibold">Sounds: </span>
                  {p.sounds
                    .map((s) => `${s.label}${s.primary && p.sounds.length > 1 ? " (main)" : ""}`)
                    .join(", ")}
                </p>
                {p.examples.length > 0 ? (
                  <p className="text-sm">
                    <span className="font-semibold">Words: </span>
                    {p.examples.map((w) => `${w.emoji ? `${w.emoji} ` : ""}${w.word}`).join(", ")}
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Pages" className="flex items-center gap-3">
        {result.page > 1 ? <Link href={link(result.page - 1)}>← Previous</Link> : null}
        <span>
          Page {result.page} of {result.pages} ({result.total} patterns)
        </span>
        {result.page < result.pages ? <Link href={link(result.page + 1)}>Next →</Link> : null}
      </nav>
    </div>
  );
}
