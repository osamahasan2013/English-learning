import type { Metadata } from "next";
import Link from "next/link";
import { WordsHeader } from "@/components/vocabulary/child-header";
import { LessonPlayer } from "@/features/lesson-player/lesson-player";
import { requireActiveChild } from "@/lib/auth/session";
import { loadSpellingPracticePayload } from "@/lib/server/lesson-loader";
import { levelCodeOf, spellingSkillIds } from "@/lib/server/spelling";

export const metadata: Metadata = { title: "Dictation" };

// Dictation: words (and, where the level has them, sentences) from the spelling lessons of
// the child's level. Replays and the slow button follow the level's spelling rules.
export default async function DictationPage() {
  const child = await requireActiveChild();
  const [levelCode, skillIds] = await Promise.all([
    levelCodeOf(child.current_level_id),
    spellingSkillIds(child.current_level_id),
  ]);
  const payload = skillIds.length
    ? await loadSpellingPracticePayload({
        skillIds,
        activities: ["DICTATION", "SENTENCE_DICTATION"],
        kind: "dictation",
        title: "Dictation",
        emoji: "📝",
        returnHref: "/child/spelling",
        returnLabel: "Spelling",
        levelCode,
      })
    : null;
  if (!payload) {
    return (
      <div className="space-y-6">
        <WordsHeader back="/child/spelling" backLabel="Back to spelling" emoji="📝" title="Dictation" />
        <div className="bg-surface space-y-4 rounded-3xl p-6 text-center shadow-sm">
          <p className="text-2xl font-bold">
            <span aria-hidden>🌱 </span>No dictation for your level yet.
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
  return <LessonPlayer payload={payload} childId={child.id} />;
}
