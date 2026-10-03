import type { Metadata } from "next";
import Link from "next/link";
import { ListenTo } from "@/components/child/listen-to";
import { SpellingCards } from "@/components/spelling/spelling-cards";
import { WordsHeader } from "@/components/vocabulary/child-header";
import { Stars } from "@/components/vocabulary/word-picture";
import { requireActiveChild } from "@/lib/auth/session";
import { masteryStars } from "@/lib/learning/phonics";
import { ProgressBar } from "@/components/ui/progress-bar";
import { loadSpellingFamilies, loadSpellingHome } from "@/lib/server/spelling";

export const metadata: Metadata = { title: "Spelling" };

// The child's spelling home: Learn, Practice, Dictation, My Words and Review as big cards,
// then the spelling lessons of their level with stars (other levels folded away).
export default async function ChildSpellingPage() {
  const child = await requireActiveChild();
  const [home, families] = await Promise.all([
    loadSpellingHome(child.id, child.current_level_id),
    loadSpellingFamilies(),
  ]);
  const cards = [
    { href: "#learn", emoji: "📘", title: "Learn", note: home.level ? home.level.name : "" },
    { href: "/child/spelling/practice", emoji: "🎯", title: "Practice", note: "" },
    { href: "/child/spelling/dictation", emoji: "📝", title: "Dictation", note: "" },
    {
      href: "/child/spelling/words",
      emoji: "⭐",
      title: "My Words",
      note: home.wordsPracticed ? String(home.wordsPracticed) : "",
    },
    {
      href: "/child/spelling/review",
      emoji: "🔁",
      title: "Review",
      note: home.dueReviews > 0 ? `${home.dueReviews} to review` : "",
    },
  ];

  return (
    <div className="space-y-8">
      <WordsHeader back="/child/home" backLabel="Go home" emoji="✏️" title="Spelling" />
      <ListenTo text="Spelling. Listen to a word, then build it or write it. Practice, try dictation, and review your words." />
      <SpellingCards cards={cards} />
      {home.wordsPracticed > 0 ? (
        <div className="bg-surface space-y-2 rounded-3xl p-4 shadow-sm">
          <p className="text-xl font-bold">
            <span aria-hidden>🏆 </span>
            {home.wordsMastered} of {home.wordsPracticed} words spelled on your own
          </p>
          <ProgressBar
            value={home.wordsMastered}
            max={Math.max(1, home.wordsPracticed)}
            label={`${home.wordsMastered} of ${home.wordsPracticed} words mastered`}
            tone="success"
          />
        </div>
      ) : null}

      <section id="learn" aria-labelledby="learn-title" className="scroll-mt-4 space-y-4">
        <h2 id="learn-title" className="text-2xl font-extrabold">
          <span aria-hidden>📘 </span>Learn
        </h2>
        {home.level ? (
          <SkillList skills={home.level.skills} />
        ) : (
          <p className="bg-surface rounded-3xl p-5 text-xl font-bold shadow-sm">
            <span aria-hidden>🌱 </span>Spelling lessons are coming soon.
          </p>
        )}
        {families.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-xl font-bold">
              <span aria-hidden>🏠 </span>Word families
            </h3>
            <ul className="flex flex-wrap gap-3">
              {families.map((f) => (
                <li key={f.code}>
                  <Link
                    href={`/child/spelling/practice?family=${f.code}`}
                    className="bg-surface hover:bg-accent-soft flex min-h-14 items-center gap-2 rounded-2xl px-5 text-2xl font-extrabold shadow-sm"
                  >
                    {f.emoji ? <span aria-hidden>{f.emoji}</span> : null}-{f.rime}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {home.levels.length > 1 ? (
          <details className="bg-surface rounded-3xl p-4 shadow-sm">
            <summary className="min-h-11 cursor-pointer text-xl font-bold">
              <span aria-hidden>🗺️ </span>More spelling
            </summary>
            <div className="mt-4 space-y-6">
              {home.levels
                .filter((l) => l.id !== home.level?.id)
                .map((level) => (
                  <div key={level.id} className="space-y-3">
                    <h3 className="text-xl font-extrabold">{level.name}</h3>
                    <SkillList skills={level.skills} />
                  </div>
                ))}
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}

function SkillList({
  skills,
}: {
  skills: NonNullable<Awaited<ReturnType<typeof loadSpellingHome>>["level"]>["skills"];
}) {
  return (
    <ul className="space-y-4">
      {skills.map((skill) => (
        <li key={skill.id} className="space-y-2">
          <p className="flex items-center gap-3 text-xl font-bold">
            {skill.title}
            {skill.status !== "NOT_STARTED" ? <Stars count={masteryStars(skill.status)} /> : null}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {skill.lessons.map((lesson) => (
              <li key={lesson.id}>
                <Link
                  href={`/child/learn/${lesson.id}`}
                  className="bg-surface hover:bg-accent-soft flex min-h-20 items-center gap-3 rounded-3xl p-4 shadow-sm transition"
                >
                  <span className="text-4xl" aria-hidden>
                    {lesson.emoji || "✏️"}
                  </span>
                  <span className="flex-1 text-lg font-bold">{lesson.title}</span>
                  <span aria-label={`${lesson.stars} of 3 stars`} className="text-xl">
                    <span aria-hidden>
                      {"⭐".repeat(lesson.stars)}
                      <span className="opacity-25">{"⭐".repeat(3 - lesson.stars)}</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
