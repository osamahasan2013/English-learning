import type { Metadata } from "next";
import Link from "next/link";
import { ListenTo } from "@/components/child/listen-to";
import { WordsHeader } from "@/components/vocabulary/child-header";
import { Stars } from "@/components/vocabulary/word-picture";
import { requireActiveChild } from "@/lib/auth/session";
import { masteryStars } from "@/lib/learning/phonics";
import { loadWritingHome, type WritingSkillGroup } from "@/lib/server/writing";

export const metadata: Metadata = { title: "Writing" };

// The child's writing home: letters to practise again (big cards), the writing lessons of
// their level by skill with stars (other levels folded away), and their latest writing.
export default async function ChildWritingPage() {
  const child = await requireActiveChild();
  const home = await loadWritingHome(child.id, child.current_level_id);

  return (
    <div className="space-y-8">
      <WordsHeader back="/child/home" backLabel="Go home" emoji="✍️" title="Writing" />
      <ListenTo text="Writing. Trace letters, write words, and write your own sentences and stories." />

      {home.letters.length > 0 ? (
        <section
          aria-labelledby="letters-title"
          className="bg-surface space-y-3 rounded-[2rem] p-5 shadow-sm"
        >
          <h2 id="letters-title" className="text-2xl font-extrabold">
            <span aria-hidden>🔁 </span>Letters to practise
          </h2>
          <ul className="flex flex-wrap gap-3">
            {home.letters.map((l) => (
              <li key={l.glyphId}>
                {l.lessonId ? (
                  <Link
                    href={`/child/learn/${l.lessonId}`}
                    aria-label={`Practise ${l.name}`}
                    className="bg-accent-soft flex size-20 items-center justify-center rounded-3xl text-5xl font-extrabold shadow-sm"
                  >
                    {l.character}
                  </Link>
                ) : (
                  <span className="bg-accent-soft flex size-20 items-center justify-center rounded-3xl text-5xl font-extrabold">
                    {l.character}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="learn-title" className="space-y-4">
        <h2 id="learn-title" className="text-2xl font-extrabold">
          <span aria-hidden>✏️ </span>Write
        </h2>
        {home.current ? (
          <SkillList skills={home.current.skills} />
        ) : (
          <p className="bg-surface rounded-3xl p-5 text-xl font-bold shadow-sm">
            <span aria-hidden>🌱 </span>Writing lessons are coming soon.
          </p>
        )}
        {home.others.length > 0 ? (
          <details className="bg-surface rounded-3xl p-4 shadow-sm">
            <summary className="min-h-11 cursor-pointer text-xl font-bold">
              <span aria-hidden>🗺️ </span>More writing
            </summary>
            <div className="mt-4 space-y-6">
              {home.others.map((level) => (
                <div key={level.id} className="space-y-3">
                  <h3 className="text-xl font-extrabold">{level.name}</h3>
                  <SkillList skills={level.skills} />
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      {home.recent.length > 0 ? (
        <section aria-labelledby="mine-title" className="space-y-3">
          <h2 id="mine-title" className="text-2xl font-extrabold">
            <span aria-hidden>📒 </span>My writing
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {home.recent.map((r, i) => (
              <li key={i} className="bg-surface space-y-1 rounded-3xl p-4 shadow-sm">
                {r.prompt ? <p className="text-muted font-semibold">{r.prompt}</p> : null}
                <p className="text-xl font-bold whitespace-pre-line">{r.text}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function SkillList({ skills }: { skills: WritingSkillGroup[] }) {
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
                    {lesson.emoji || "✍️"}
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
