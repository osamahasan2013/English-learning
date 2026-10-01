import type { Metadata } from "next";
import Link from "next/link";
import { ListenTo } from "@/components/child/listen-to";
import { WordsHeader } from "@/components/vocabulary/child-header";
import { WordTile } from "@/components/vocabulary/word-tile";
import { ProgressBar } from "@/components/ui/progress-bar";
import { requireActiveChild } from "@/lib/auth/session";
import { loadVocabularyHome } from "@/lib/server/vocabulary";

export const metadata: Metadata = { title: "Words" };

// The child's vocabulary home: My Words, New Words, Practice, Categories and the Word
// Explorer as big cards, then today's new words and every category with progress.
export default async function ChildWordsPage() {
  const child = await requireActiveChild();
  const home = await loadVocabularyHome(child.id, child.current_level_id);
  const cards = [
    { href: "/child/words/mine", emoji: "⭐", title: "My Words", note: String(home.myWords) },
    { href: "#new-words", emoji: "✨", title: "New Words", note: String(home.newWords.length) },
    {
      href: "/child/words/practice",
      emoji: "🎯",
      title: "Practice",
      note: home.dueReviews > 0 ? `${home.dueReviews} to review` : "",
    },
    { href: "#categories", emoji: "🗂️", title: "Categories", note: "" },
    { href: "/child/words/find", emoji: "🔎", title: "Word Explorer", note: "" },
  ];

  return (
    <div className="space-y-8">
      <WordsHeader back="/child/home" backLabel="Go home" emoji="📚" title="Words" />
      <ListenTo text="Words. Learn new words, save them in My Words, and practice them." />

      <nav aria-label="Words">
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map((card) => (
            <li key={card.title}>
              <Link
                href={card.href}
                className="bg-surface hover:bg-accent-soft flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-[2rem] p-4 text-center shadow-sm transition hover:scale-[1.02]"
              >
                <span className="text-5xl" aria-hidden>
                  {card.emoji}
                </span>
                <span className="text-2xl font-extrabold">{card.title}</span>
                {card.note ? <span className="text-muted text-lg font-bold">{card.note}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section id="new-words" aria-labelledby="new-words-title" className="scroll-mt-4 space-y-3">
        <h2 id="new-words-title" className="text-2xl font-extrabold">
          <span aria-hidden>✨ </span>New words
        </h2>
        {home.newWords.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {home.newWords.map((w) => (
              <li key={w.id}>
                <WordTile id={w.id} word={w.word} emoji={w.emoji} badge="New" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="bg-surface rounded-3xl p-5 text-xl font-bold shadow-sm">
            <span aria-hidden>🎉 </span>You met all the words for your level!
          </p>
        )}
      </section>

      <section id="categories" aria-labelledby="categories-title" className="scroll-mt-4 space-y-3">
        <h2 id="categories-title" className="text-2xl font-extrabold">
          <span aria-hidden>🗂️ </span>Categories
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {home.categories.map((c) => (
            <li key={c.id}>
              <Link
                href={`/child/words/category/${c.code}`}
                className="bg-surface hover:bg-accent-soft flex flex-col gap-2 rounded-3xl p-4 shadow-sm transition"
              >
                <span className="flex items-center gap-2 text-xl font-bold">
                  <span className="text-3xl" aria-hidden>
                    {c.emoji}
                  </span>
                  {c.name}
                </span>
                <ProgressBar
                  value={c.started}
                  max={Math.max(1, c.total)}
                  label={`${c.name}: ${c.started} of ${c.total} words`}
                  tone="success"
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
