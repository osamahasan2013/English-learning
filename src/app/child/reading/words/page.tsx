import type { Metadata } from "next";
import Link from "next/link";
import { WordsHeader } from "@/components/vocabulary/child-header";
import { LessonPlayer } from "@/features/lesson-player/lesson-player";
import { requireActiveChild } from "@/lib/auth/session";
import { loadWordPracticePayload } from "@/lib/server/lesson-loader";
import { readingWordsToPractise } from "@/lib/server/reading";
import { levelCodeOf } from "@/lib/server/spelling";

export const metadata: Metadata = { title: "Tricky reading words" };

// Practice the words the child keeps tapping for help while reading (the review queue's
// reading items): ordinary word practice with the questions about those words.
export default async function ReadingWordsPage() {
  const child = await requireActiveChild();
  const wordIds = await readingWordsToPractise(child.id, 6);
  const payload = wordIds.length
    ? await loadWordPracticePayload({
        wordIds,
        kind: "word",
        title: "Tricky reading words",
        emoji: "🔎",
        returnHref: "/child/reading",
        levelCode: await levelCodeOf(child.current_level_id),
      })
    : null;
  if (!payload) {
    return (
      <div className="space-y-6">
        <WordsHeader back="/child/reading" backLabel="Back to reading" emoji="🔎" title="Tricky words" />
        <div className="bg-surface space-y-4 rounded-3xl p-6 text-center shadow-sm">
          <p className="text-2xl font-bold">
            <span aria-hidden>🌟 </span>No tricky words to practice right now. Keep reading!
          </p>
          <Link
            href="/child/reading"
            className="bg-success inline-flex min-h-16 items-center rounded-3xl px-8 text-2xl font-bold text-white"
          >
            <span aria-hidden>📖 </span>&nbsp;Read a story
          </Link>
        </div>
      </div>
    );
  }
  return <LessonPlayer payload={payload} childId={child.id} learningEpoch={child.learning_epoch} />;
}
