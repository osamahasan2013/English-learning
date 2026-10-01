import type { Metadata } from "next";
import Link from "next/link";
import { WordsHeader } from "@/components/vocabulary/child-header";
import { LessonPlayer } from "@/features/lesson-player/lesson-player";
import { requireActiveChild } from "@/lib/auth/session";
import { loadWordPracticePayload } from "@/lib/server/lesson-loader";
import { wordsToPractise } from "@/lib/server/vocabulary";

export const metadata: Metadata = { title: "Practice my words" };

// Practice My Words: the words due for review first (weak, missed, scheduled), then the
// other saved words by review priority.
export default async function PractiseMyWordsPage() {
  const child = await requireActiveChild();
  const wordIds = await wordsToPractise(child.id, 6);
  const payload = wordIds.length
    ? await loadWordPracticePayload({
        wordIds,
        kind: "my_words",
        title: "My Words",
        emoji: "⭐",
        returnHref: "/child/words/mine",
      })
    : null;
  if (!payload) {
    return (
      <div className="space-y-6">
        <WordsHeader back="/child/words" backLabel="Back to words" emoji="🎯" title="Practice" />
        <div className="bg-surface space-y-4 rounded-3xl p-6 text-center shadow-sm">
          <p className="text-2xl font-bold">
            <span aria-hidden>⭐ </span>Save some words first, then practice them here.
          </p>
          <Link
            href="/child/words#categories"
            className="bg-success inline-flex min-h-16 items-center rounded-3xl px-8 text-2xl font-bold text-white"
          >
            <span aria-hidden>🗂️ </span>&nbsp;Find words
          </Link>
        </div>
      </div>
    );
  }
  return <LessonPlayer payload={payload} childId={child.id} />;
}
