import type { Metadata } from "next";
import Link from "next/link";
import { ListenTo } from "@/components/child/listen-to";
import { WordsHeader } from "@/components/vocabulary/child-header";
import { SaveWordButton } from "@/components/vocabulary/save-word-button";
import { WordTile } from "@/components/vocabulary/word-tile";
import { requireActiveChild } from "@/lib/auth/session";
import { loadMyWords } from "@/lib/server/vocabulary";

export const metadata: Metadata = { title: "My Words" };

// My Words: the child's saved words, the ones to review first, each with its stars and a
// button to take it out.
export default async function MyWordsPage() {
  const child = await requireActiveChild();
  const words = await loadMyWords(child.id);
  const due = words.filter((w) => w.due).length;

  return (
    <div className="space-y-6">
      <WordsHeader back="/child/words" backLabel="Back to words" emoji="⭐" title="My Words" />
      <ListenTo text="My Words. These are your words. Practice them to get stars." />
      {words.length > 0 ? (
        <>
          <Link
            href="/child/words/practice"
            className="bg-success flex items-center gap-5 rounded-[2rem] p-6 text-white shadow-lg transition hover:brightness-110"
          >
            <span
              className="flex size-16 shrink-0 items-center justify-center rounded-full bg-white/20 text-4xl"
              aria-hidden
            >
              🎯
            </span>
            <span>
              <span className="block text-3xl font-extrabold">Practice my words</span>
              {due > 0 ? (
                <span className="block text-lg font-semibold opacity-90">{due} to review</span>
              ) : null}
            </span>
          </Link>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {words.map((w) => (
              <li key={w.id} className="flex flex-col items-center gap-2">
                <WordTile
                  id={w.id}
                  word={w.word}
                  emoji={w.emoji}
                  status={w.status}
                  badge={w.due ? "Review" : undefined}
                />
                <SaveWordButton wordId={w.id} word={w.word} saved compact />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="bg-surface space-y-4 rounded-3xl p-6 text-center shadow-sm">
          <p className="text-2xl font-bold">
            <span aria-hidden>⭐ </span>Tap “Save to My Words” on a word to keep it here.
          </p>
          <Link
            href="/child/words#new-words"
            className="bg-success inline-flex min-h-16 items-center rounded-3xl px-8 text-2xl font-bold text-white"
          >
            <span aria-hidden>✨ </span>&nbsp;New words
          </Link>
        </div>
      )}
    </div>
  );
}
