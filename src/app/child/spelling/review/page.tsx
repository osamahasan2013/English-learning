import type { Metadata } from "next";
import Link from "next/link";
import { ListenTo } from "@/components/child/listen-to";
import { WordsHeader } from "@/components/vocabulary/child-header";
import { WordTile } from "@/components/vocabulary/word-tile";
import { requireActiveChild } from "@/lib/auth/session";
import { loadSpellingReview } from "@/lib/server/spelling";

export const metadata: Metadata = { title: "Spelling review" };

// Spelling review: the words due again (missed, weak, at their review date) and the sounds
// the child keeps spelling wrong — those go back to their phonics lesson.
export default async function SpellingReviewPage() {
  const child = await requireActiveChild();
  const review = await loadSpellingReview(child.id);
  const empty = review.words.length === 0 && review.patterns.length === 0;

  return (
    <div className="space-y-6">
      <WordsHeader back="/child/spelling" backLabel="Back to spelling" emoji="🔁" title="Review" />
      <ListenTo text="Review. Practice the words and sounds that need another go." />
      {empty ? (
        <p className="bg-surface rounded-3xl p-6 text-center text-2xl font-bold shadow-sm">
          <span aria-hidden>🎉 </span>Nothing to review right now!
        </p>
      ) : null}
      {review.words.length > 0 ? (
        <section aria-labelledby="review-words" className="space-y-3">
          <h2 id="review-words" className="text-2xl font-extrabold">
            <span aria-hidden>✏️ </span>Words to spell again
          </h2>
          <Link
            href="/child/spelling/practice?review=1"
            className="bg-success flex items-center gap-5 rounded-[2rem] p-6 text-white shadow-lg transition hover:brightness-110"
          >
            <span
              className="flex size-16 shrink-0 items-center justify-center rounded-full bg-white/20 text-4xl"
              aria-hidden
            >
              🎯
            </span>
            <span className="block text-3xl font-extrabold">Practice these words</span>
          </Link>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {review.words.map((w) => (
              <li key={w.id}>
                <WordTile id={w.id} word={w.word} emoji={w.emoji} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {review.patterns.length > 0 ? (
        <section aria-labelledby="review-sounds" className="space-y-3">
          <h2 id="review-sounds" className="text-2xl font-extrabold">
            <span aria-hidden>🔤 </span>Sounds to practise
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {review.patterns.map((p) => (
              <li key={p.id} className="space-y-2">
                {p.lessonId ? (
                  <Link
                    href={`/child/learn/${p.lessonId}`}
                    className="bg-surface hover:bg-accent-soft flex items-center gap-4 rounded-3xl p-5 shadow-sm transition"
                  >
                    <span className="text-primary text-5xl font-extrabold">
                      {p.pattern.replace("_", "–")}
                    </span>
                    <span className="text-lg font-semibold">{p.explanation || "Practise this sound."}</span>
                  </Link>
                ) : (
                  <div className="bg-surface flex items-center gap-4 rounded-3xl p-5 shadow-sm">
                    <span className="text-primary text-5xl font-extrabold">
                      {p.pattern.replace("_", "–")}
                    </span>
                    <span className="text-lg font-semibold">{p.explanation || "Practise this sound."}</span>
                  </div>
                )}
                <Link
                  href={p.practiceHref}
                  className="bg-success flex min-h-14 items-center justify-center gap-2 rounded-2xl px-5 text-xl font-bold text-white"
                >
                  <span aria-hidden>✏️</span> Spell {p.pattern.replace("_", "–")} words
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
