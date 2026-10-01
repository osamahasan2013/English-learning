import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListenTo } from "@/components/child/listen-to";
import { WordsHeader } from "@/components/vocabulary/child-header";
import { WordTile } from "@/components/vocabulary/word-tile";
import { requireActiveChild } from "@/lib/auth/session";
import { loadCategoryWords } from "@/lib/server/vocabulary";

export const metadata: Metadata = { title: "Words" };

// One category's words (with its sub-categories), a page at a time.
export default async function CategoryWordsPage(props: PageProps<"/child/words/category/[code]">) {
  const child = await requireActiveChild();
  const { code } = await props.params;
  const { page: pageParam } = await props.searchParams;
  const page = Math.max(1, Number(typeof pageParam === "string" ? pageParam : 1) || 1);
  const data = await loadCategoryWords(child.id, code.toUpperCase().slice(0, 40), page);
  if (!data) notFound();
  const link = (p: number) => `/child/words/category/${data.category.code}?page=${p}`;

  return (
    <div className="space-y-6">
      <WordsHeader
        back="/child/words#categories"
        backLabel="Back to words"
        emoji={data.category.emoji}
        title={data.category.name}
      />
      <ListenTo text={`${data.category.name}. Tap a word to learn it.`} />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {data.words.map((w) => (
          <li key={w.id}>
            <WordTile id={w.id} word={w.word} emoji={w.emoji} image={w.image} status={w.status} />
          </li>
        ))}
      </ul>
      {data.pages > 1 ? (
        <nav aria-label="More words" className="flex items-center justify-center gap-4">
          {data.page > 1 ? (
            <Link
              href={link(data.page - 1)}
              className="bg-surface rounded-3xl px-6 py-4 text-xl font-bold shadow-sm"
            >
              <span aria-hidden>⬅ </span>Back
            </Link>
          ) : null}
          <span className="text-muted text-lg font-bold">
            {data.page} / {data.pages}
          </span>
          {data.page < data.pages ? (
            <Link
              href={link(data.page + 1)}
              className="bg-success rounded-3xl px-6 py-4 text-xl font-bold text-white shadow-sm"
            >
              More words<span aria-hidden> ➡</span>
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
