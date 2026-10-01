import type { Metadata } from "next";
import Link from "next/link";
import { WordsHeader } from "@/components/vocabulary/child-header";
import { WordTile } from "@/components/vocabulary/word-tile";
import { requireActiveChild } from "@/lib/auth/session";
import { searchWords } from "@/lib/server/vocabulary";
import { parseWordSearch, wordSearchQuery } from "@/lib/validation/vocabulary";

export const metadata: Metadata = { title: "Word Explorer" };

// Find a word by how it starts (searched in the database, one page at a time).
export default async function FindWordPage(props: PageProps<"/child/words/find">) {
  await requireActiveChild();
  const search = parseWordSearch(await props.searchParams);
  const result = search.q ? await searchWords({ q: search.q, page: search.page }) : null;
  const link = (page: number) => `/child/words/find?${wordSearchQuery({ q: search.q }, { page })}`;

  return (
    <div className="space-y-6">
      <WordsHeader back="/child/words" backLabel="Back to words" emoji="🔎" title="Word Explorer" />
      <form role="search" action="/child/words/find" className="flex flex-wrap gap-3">
        <label htmlFor="q" className="sr-only">
          Find a word
        </label>
        <input
          id="q"
          name="q"
          defaultValue={search.q ?? ""}
          placeholder="cat"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={40}
          className="bg-surface border-border min-h-16 flex-1 rounded-3xl border-2 px-5 text-3xl font-bold"
        />
        <button type="submit" className="bg-primary min-h-16 rounded-3xl px-6 text-2xl font-bold text-white">
          <span aria-hidden>🔎 </span>Find
        </button>
      </form>
      {result ? (
        result.words.length > 0 ? (
          <>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {result.words.map((w) => (
                <li key={w.id}>
                  <WordTile id={w.id} word={w.word} emoji={w.emoji} image={w.image} />
                </li>
              ))}
            </ul>
            {result.page < result.pages ? (
              <Link
                href={link(result.page + 1)}
                className="bg-success block rounded-3xl p-4 text-center text-xl font-bold text-white"
              >
                More words<span aria-hidden> ➡</span>
              </Link>
            ) : null}
          </>
        ) : (
          <p className="bg-surface rounded-3xl p-6 text-2xl font-bold shadow-sm">
            <span aria-hidden>🤔 </span>No words start like that. Try again!
          </p>
        )
      ) : (
        <p className="text-muted text-xl font-semibold">Type the start of a word, then tap Find.</p>
      )}
    </div>
  );
}
