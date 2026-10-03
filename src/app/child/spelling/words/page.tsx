import type { Metadata } from "next";
import Link from "next/link";
import { ListenTo } from "@/components/child/listen-to";
import { WordsHeader } from "@/components/vocabulary/child-header";
import { WordTile } from "@/components/vocabulary/word-tile";
import { requireActiveChild } from "@/lib/auth/session";
import { loadMySpellingWords } from "@/lib/server/spelling";

export const metadata: Metadata = { title: "My spelling words" };

// My Spelling Words: every word the child has spelled, latest first, with spelling stars
// (spelling mastery — separate from knowing the word), a page at a time.
export default async function MySpellingWordsPage(props: PageProps<"/child/spelling/words">) {
  const child = await requireActiveChild();
  const { page: pageParam } = await props.searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const { words, total, pageSize } = await loadMySpellingWords(child.id, page);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <WordsHeader back="/child/spelling" backLabel="Back to spelling" emoji="⭐" title="My spelling words" />
      <ListenTo text="My spelling words. Spell a word right on your own to get stars." />
      {words.length > 0 ? (
        <>
          <Link
            href="/child/spelling/practice"
            className="bg-success flex items-center gap-5 rounded-[2rem] p-6 text-white shadow-lg transition hover:brightness-110"
          >
            <span
              className="flex size-16 shrink-0 items-center justify-center rounded-full bg-white/20 text-4xl"
              aria-hidden
            >
              🎯
            </span>
            <span className="block text-3xl font-extrabold">Practice spelling</span>
          </Link>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6" aria-label="Spelling words">
            {words.map((w) => (
              <li key={w.id}>
                <WordTile
                  id={w.id}
                  word={w.word}
                  emoji={w.emoji}
                  status={w.status}
                  badge={w.due ? "Review" : undefined}
                />
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center justify-center gap-3">
              {page > 1 ? (
                <Link
                  href={`/child/spelling/words?page=${page - 1}`}
                  className="bg-surface min-h-12 rounded-2xl px-5 py-3 text-xl font-bold shadow-sm"
                >
                  <span aria-hidden>⬅ </span>Back
                </Link>
              ) : null}
              <span className="text-muted text-lg font-bold">
                {page} / {pages}
              </span>
              {page < pages ? (
                <Link
                  href={`/child/spelling/words?page=${page + 1}`}
                  className="bg-surface min-h-12 rounded-2xl px-5 py-3 text-xl font-bold shadow-sm"
                >
                  More<span aria-hidden> ➜</span>
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      ) : (
        <div className="bg-surface space-y-4 rounded-3xl p-6 text-center shadow-sm">
          <p className="text-2xl font-bold">
            <span aria-hidden>✏️ </span>Spell some words and they will show up here.
          </p>
          <Link
            href="/child/spelling#learn"
            className="bg-success inline-flex min-h-16 items-center rounded-3xl px-8 text-2xl font-bold text-white"
          >
            <span aria-hidden>📘 </span>&nbsp;Learn
          </Link>
        </div>
      )}
    </div>
  );
}
