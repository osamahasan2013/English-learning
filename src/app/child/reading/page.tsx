import type { Metadata } from "next";
import Link from "next/link";
import { ListenTo } from "@/components/child/listen-to";
import { WordsHeader } from "@/components/vocabulary/child-header";
import { requireActiveChild } from "@/lib/auth/session";
import { loadReadingHome, type LibraryItem } from "@/lib/server/reading";

export const metadata: Metadata = { title: "Reading" };

const REASONS = {
  next: { emoji: "✨", label: "Read next" },
  reread: { emoji: "🔁", label: "Read it again" },
  stretch: { emoji: "🚀", label: "A bit harder" },
} as const;

// The child's reading home: what to read next (big cards), words to practise from their
// reading, and the library of texts at their level (other levels folded away). Each text
// opens its reading lesson: get ready → words → read → questions.
export default async function ChildReadingPage() {
  const child = await requireActiveChild();
  const home = await loadReadingHome(child.id, child.current_level_id);
  const atLevel = home.items.filter((i) => i.levelRank === home.levelRank && i.lessonId);
  const others = home.items.filter((i) => i.levelRank !== home.levelRank && i.lessonId);
  const levels = [...new Map(others.map((i) => [i.levelId, i.levelName])).entries()];

  return (
    <div className="space-y-8">
      <WordsHeader back="/child/home" backLabel="Go home" emoji="📖" title="Reading" />
      <ListenTo text="Reading. Pick a story. Listen to it, read it, then answer some questions." />

      {home.recommended.length > 0 ? (
        <section aria-labelledby="next-title" className="space-y-3">
          <h2 id="next-title" className="text-2xl font-extrabold">
            <span aria-hidden>⭐ </span>For you
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {home.recommended.map((r) => (
              <li key={r.storyId}>
                <Link
                  href={`/child/learn/${r.item.lessonId}`}
                  className="bg-surface hover:bg-accent-soft flex min-h-36 flex-col items-center justify-center gap-2 rounded-[2rem] p-5 text-center shadow-sm transition hover:scale-[1.02]"
                >
                  <span className="text-6xl" aria-hidden>
                    {r.item.emoji || "📖"}
                  </span>
                  <span className="text-2xl font-extrabold">{r.item.title}</span>
                  <span className="text-muted text-lg font-bold">
                    <span aria-hidden>{REASONS[r.reason].emoji} </span>
                    {REASONS[r.reason].label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {home.helpWords.length > 0 ? (
        <section aria-labelledby="words-title" className="bg-surface space-y-3 rounded-[2rem] p-5 shadow-sm">
          <h2 id="words-title" className="text-2xl font-extrabold">
            <span aria-hidden>🔎 </span>Tricky words from your reading
          </h2>
          <ul className="flex flex-wrap gap-2">
            {home.helpWords.map((w) => (
              <li key={w.wordId} className="bg-accent-soft rounded-2xl px-4 py-2 text-2xl font-bold">
                {w.emoji ? <span aria-hidden>{w.emoji} </span> : null}
                {w.word}
              </li>
            ))}
          </ul>
          <Link
            href="/child/reading/words"
            className="bg-success inline-flex min-h-14 items-center gap-2 rounded-2xl px-6 text-xl font-bold text-white"
          >
            <span aria-hidden>🎯</span> Practice them
          </Link>
        </section>
      ) : null}

      <section aria-labelledby="library-title" className="space-y-3">
        <h2 id="library-title" className="text-2xl font-extrabold">
          <span aria-hidden>📚 </span>Story shelf
        </h2>
        {atLevel.length > 0 ? (
          <Shelf items={atLevel} />
        ) : (
          <p className="bg-surface rounded-3xl p-5 text-xl font-bold shadow-sm">
            <span aria-hidden>🌱 </span>Stories for your level are coming soon.
          </p>
        )}
        {levels.length > 0 ? (
          <details className="bg-surface rounded-3xl p-4 shadow-sm">
            <summary className="min-h-11 cursor-pointer text-xl font-bold">
              <span aria-hidden>🗺️ </span>More stories
            </summary>
            <div className="mt-4 space-y-6">
              {levels.map(([id, name]) => (
                <div key={id} className="space-y-3">
                  <h3 className="text-xl font-extrabold">{name}</h3>
                  <Shelf items={others.filter((i) => i.levelId === id)} />
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}

function Shelf({ items }: { items: LibraryItem[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <li key={item.storyId}>
          <Link
            href={`/child/learn/${item.lessonId}`}
            className="bg-surface hover:bg-accent-soft flex min-h-24 items-center gap-3 rounded-3xl p-4 shadow-sm transition"
          >
            <span className="text-5xl" aria-hidden>
              {item.emoji || "📖"}
            </span>
            <span className="flex-1">
              <span className="block text-xl font-bold">{item.title}</span>
              <span className="text-muted block font-semibold">
                {item.contentTypeEmoji ? <span aria-hidden>{item.contentTypeEmoji} </span> : null}
                {item.contentTypeName}
                {item.readings > 0 ? " · read ✓" : ""}
              </span>
            </span>
            <span aria-label={`${item.stars} of 3 stars`} className="text-xl">
              <span aria-hidden>
                {"⭐".repeat(item.stars)}
                <span className="opacity-25">{"⭐".repeat(3 - item.stars)}</span>
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
