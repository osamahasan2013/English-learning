import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WordsHeader } from "@/components/vocabulary/child-header";
import { LessonPlayer } from "@/features/lesson-player/lesson-player";
import { requireActiveChild } from "@/lib/auth/session";
import { levelCodeOf } from "@/lib/server/spelling";
import { isWordArea } from "@/lib/learning/vocabulary";
import { loadWordPracticePayload } from "@/lib/server/lesson-loader";
import { loadWordDetail } from "@/lib/server/vocabulary";

export const metadata: Metadata = { title: "Practice" };

// Practice one word (optionally one area: read, spell, listen) in the ordinary lesson
// player, with the word's published lesson questions.
export default async function WordPracticePage(props: PageProps<"/child/words/[wordId]/practice">) {
  const child = await requireActiveChild();
  const { wordId } = await props.params;
  const { area: areaParam } = await props.searchParams;
  const area = isWordArea(areaParam) ? areaParam : undefined;
  const word = await loadWordDetail(wordId);
  if (!word) notFound();
  const payload = await loadWordPracticePayload({
    wordIds: [word.id],
    area,
    kind: "word",
    title: word.word,
    emoji: word.emoji || "📖",
    returnHref: `/child/words/${word.id}`,
    levelCode: await levelCodeOf(child.current_level_id),
  });
  if (!payload) {
    return (
      <div className="space-y-6">
        <WordsHeader
          back={`/child/words/${word.id}`}
          backLabel="Back to the word"
          emoji="🎯"
          title="Practice"
        />
        <p className="bg-surface rounded-3xl p-6 text-2xl font-bold shadow-sm">
          <span aria-hidden>🌱 </span>No games for this word yet. Try another word!
        </p>
      </div>
    );
  }
  return <LessonPlayer payload={payload} childId={child.id} learningEpoch={child.learning_epoch} />;
}
