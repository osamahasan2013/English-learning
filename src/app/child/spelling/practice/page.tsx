import type { Metadata } from "next";
import Link from "next/link";
import { WordsHeader } from "@/components/vocabulary/child-header";
import { LessonPlayer } from "@/features/lesson-player/lesson-player";
import { requireActiveChild } from "@/lib/auth/session";
import { loadSpellingPracticePayload } from "@/lib/server/lesson-loader";
import {
  levelCodeOf,
  loadSpellingReview,
  spellingWordsForFamily,
  spellingWordsForPattern,
  spellingWordsToPractise,
} from "@/lib/server/spelling";

export const metadata: Metadata = { title: "Spelling practice" };

// Spelling practice: the words due for review first (missed, weak, scheduled), then words
// not yet mastered, then new spelling words of the child's level — played in the ordinary
// lesson player with spelling questions only. ?review=1 practises exactly the review words,
// ?pattern=<id> words with a phonics pattern (from a pattern review), ?family=<code> a word
// family (-at: bat, rat …).
export default async function SpellingPracticePage(props: PageProps<"/child/spelling/practice">) {
  const child = await requireActiveChild();
  const { review, pattern, family } = await props.searchParams;
  const [levelCode, wordIds] = await Promise.all([
    levelCodeOf(child.current_level_id),
    review === "1"
      ? loadSpellingReview(child.id).then((r) => r.words.map((w) => w.id))
      : typeof pattern === "string"
        ? spellingWordsForPattern(pattern, child.current_level_id, 6)
        : typeof family === "string"
          ? spellingWordsForFamily(family, 6)
          : spellingWordsToPractise(child.id, child.current_level_id, 6),
  ]);
  const payload = wordIds.length
    ? await loadSpellingPracticePayload({
        wordIds,
        kind: "spelling",
        title: review === "1" || pattern ? "Spelling review" : family ? "Word family" : "Spelling practice",
        emoji: review === "1" || pattern ? "🔁" : family ? "🏠" : "🎯",
        returnHref: "/child/spelling",
        returnLabel: "Spelling",
        levelCode,
      })
    : null;
  if (!payload) {
    return (
      <div className="space-y-6">
        <WordsHeader back="/child/spelling" backLabel="Back to spelling" emoji="🎯" title="Practice" />
        <div className="bg-surface space-y-4 rounded-3xl p-6 text-center shadow-sm">
          <p className="text-2xl font-bold">
            <span aria-hidden>📘 </span>Start a spelling lesson first, then practice here.
          </p>
          <Link
            href="/child/spelling#learn"
            className="bg-success inline-flex min-h-16 items-center rounded-3xl px-8 text-2xl font-bold text-white"
          >
            <span aria-hidden>📘 </span>&nbsp;Learn
          </Link>
        </div>
      </div>
    );
  }
  return <LessonPlayer payload={payload} childId={child.id} learningEpoch={child.learning_epoch} />;
}
