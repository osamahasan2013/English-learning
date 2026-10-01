import type { Metadata } from "next";
import Link from "next/link";
import { MASTERY_LABELS } from "@/components/parent/skill-badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { requireActiveChild } from "@/lib/auth/session";
import { lessonPrerequisiteCheck, type RecommendationReason } from "@/lib/learning/engine";
import { getRecommendedLessons, loadEngineInput } from "@/lib/server/learning-engine";
import { listPublishedLevels, loadChildHome, loadEngineProgress } from "@/lib/server/family-data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Home" };

const REASON_LABELS: Record<RecommendationReason, string> = {
  continue: "Keep going",
  next: "Next",
  review: "Practice",
  prerequisite: "Practise first",
};

export default async function ChildHomePage() {
  const child = await requireActiveChild();
  const [home, recommendations, engineInput, engineProgress, levels] = await Promise.all([
    loadChildHome(child),
    getRecommendedLessons(child.id),
    loadEngineInput(child.id),
    loadEngineProgress(child.id, child.current_level_id),
    listPublishedLevels(),
  ]);
  const level = levels.find((l) => l.id === child.current_level_id);
  const recommended = recommendations[0] ?? null;
  const fallback = home.plan[0];
  const more = recommendations.slice(1);

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-center gap-4">
        <h1 className="text-4xl font-extrabold">Hi, {child.name}!</h1>
        {level ? (
          <span className="bg-surface rounded-full px-4 py-2 text-xl font-bold shadow-sm">
            <span aria-hidden>{level.theme_emoji} </span>
            {level.name}
          </span>
        ) : null}
        <Link
          href="/child/rewards"
          className="bg-surface ml-auto flex items-center gap-2 rounded-full px-5 py-2 text-2xl font-extrabold shadow-sm"
        >
          <span aria-hidden>⭐</span> {home.stars}
          <span className="sr-only">stars. See my rewards.</span>
        </Link>
      </section>

      {recommended || fallback ? (
        <Link
          href={`/child/learn/${recommended?.lessonId ?? fallback.lessonId}`}
          className="bg-success flex items-center gap-5 rounded-[2rem] p-6 text-white shadow-lg transition hover:brightness-110"
        >
          <span
            className="flex size-20 shrink-0 items-center justify-center rounded-full bg-white/20 text-5xl"
            aria-hidden
          >
            {recommended?.emoji || "▶"}
          </span>
          <span>
            <span className="block text-lg font-semibold opacity-90">
              {recommended
                ? REASON_LABELS[recommended.reason]
                : fallback.kind === "review"
                  ? "Practice"
                  : "Next"}
            </span>
            <span className="block text-3xl font-extrabold">{recommended?.title ?? fallback.title}</span>
          </span>
        </Link>
      ) : (
        <div className="bg-surface rounded-[2rem] p-6 text-center text-2xl font-bold shadow-sm">
          <span aria-hidden>🎉 </span>You finished everything here!
        </div>
      )}

      <Link
        href="/child/phonics"
        className="bg-surface hover:bg-accent-soft flex items-center gap-4 rounded-[2rem] p-5 shadow-sm transition"
      >
        <span
          className="bg-accent-soft flex size-16 shrink-0 items-center justify-center rounded-full text-4xl"
          aria-hidden
        >
          🔤
        </span>
        <span>
          <span className="block text-3xl font-extrabold">Phonics</span>
          <span className="text-muted block text-lg font-semibold">Letters · Sounds · Blend · Read</span>
        </span>
      </Link>

      <Link
        href="/child/words"
        className="bg-surface hover:bg-accent-soft flex items-center gap-4 rounded-[2rem] p-5 shadow-sm transition"
      >
        <span
          className="bg-accent-soft flex size-16 shrink-0 items-center justify-center rounded-full text-4xl"
          aria-hidden
        >
          📚
        </span>
        <span>
          <span className="block text-3xl font-extrabold">Words</span>
          <span className="text-muted block text-lg font-semibold">My Words · New Words · Practice</span>
        </span>
      </Link>

      {more.length > 0 ? (
        <section aria-labelledby="for-you" className="space-y-3">
          <h2 id="for-you" className="text-2xl font-extrabold">
            <span aria-hidden>✨ </span>Also for you
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {more.map((r) => (
              <li key={r.lessonId}>
                <Link
                  href={`/child/learn/${r.lessonId}`}
                  className="bg-surface hover:bg-accent-soft flex min-h-20 items-center gap-3 rounded-3xl p-4 shadow-sm transition"
                >
                  <span className="text-3xl" aria-hidden>
                    {r.emoji || (r.reason === "review" ? "🔁" : "✨")}
                  </span>
                  <span>
                    <span className="block text-xl font-bold">{r.title}</span>
                    <span className="text-muted block">{REASON_LABELS[r.reason]}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {home.plan.length > 1 ? (
        <section aria-labelledby="today" className="space-y-3">
          <h2 id="today" className="text-2xl font-extrabold">
            <span aria-hidden>☀️ </span>Today
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {home.plan.map((item, i) => (
              <li key={`${item.lessonId}-${i}`}>
                <Link
                  href={`/child/learn/${item.lessonId}`}
                  className="bg-surface hover:bg-accent-soft flex min-h-20 items-center gap-3 rounded-3xl p-4 shadow-sm transition"
                >
                  <span className="text-3xl" aria-hidden>
                    {item.kind === "review" ? "🔁" : "✨"}
                  </span>
                  <span>
                    <span className="block text-xl font-bold">{item.title}</span>
                    <span className="text-muted block">
                      {item.kind === "review" ? "Practice" : item.subjectName} · {item.minutes} min
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {engineProgress.subjectProgress.length > 0 ? (
        <section aria-labelledby="subjects" className="space-y-3">
          <h2 id="subjects" className="text-2xl font-extrabold">
            <span aria-hidden>🧭 </span>My subjects
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {engineProgress.subjectProgress.map((subject) => (
              <li key={subject.subjectId} className="bg-surface space-y-2 rounded-3xl p-4 shadow-sm">
                <p className="flex items-center justify-between gap-2 text-xl font-bold">
                  <span>
                    <span aria-hidden>{subject.emoji} </span>
                    {subject.name}
                  </span>
                  <span className="text-muted text-lg">
                    {subject.lessonsCompleted}/{subject.lessonsTotal}
                  </span>
                </p>
                <ProgressBar
                  value={subject.lessonsCompleted}
                  max={Math.max(1, subject.lessonsTotal)}
                  label={`${subject.name}: ${subject.lessonsCompleted} of ${subject.lessonsTotal} lessons done`}
                  tone="success"
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {home.recentLessons.length > 0 ? (
        <section aria-labelledby="recent" className="space-y-3">
          <h2 id="recent" className="text-2xl font-extrabold">
            <span aria-hidden>🕘 </span>Recent lessons
          </h2>
          <ul className="grid gap-3 sm:grid-cols-3">
            {home.recentLessons.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/child/learn/${r.lessonId}`}
                  className="bg-surface flex min-h-20 items-center gap-3 rounded-3xl p-4 shadow-sm"
                >
                  <span className="text-3xl" aria-hidden>
                    {r.emoji || "📘"}
                  </span>
                  <span>
                    <span className="block text-xl font-bold">{r.title}</span>
                    <span aria-label={`${r.stars} stars`}>{"⭐".repeat(r.stars)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {home.skills.length > 0 ? (
        <section aria-labelledby="skills" className="space-y-3">
          <h2 id="skills" className="text-2xl font-extrabold">
            <span aria-hidden>🌱 </span>My skills
          </h2>
          <ul className="flex flex-wrap gap-2">
            {home.skills.map((skill) => {
              const label = MASTERY_LABELS[skill.status];
              return (
                <li
                  key={skill.id}
                  className={cn(
                    "flex items-center gap-2 rounded-full px-4 py-2 text-lg font-bold",
                    label.className,
                  )}
                >
                  <span aria-hidden>{label.icon}</span>
                  {skill.title}
                  <span className="sr-only">: {label.label}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="path" className="space-y-4">
        <h2 id="path" className="text-2xl font-extrabold">
          <span aria-hidden>🗺️ </span>My path
          <span className="text-muted ml-2 text-lg font-semibold">
            {home.lessonsCompleted}/{home.lessonsTotal}
          </span>
        </h2>
        {home.path.length === 0 ? <p className="text-muted text-xl">Lessons are on the way!</p> : null}
        {home.path.map((unit) => (
          <div key={unit.id} className="space-y-3">
            <h3 className="text-xl font-bold">
              <span aria-hidden>{unit.emoji} </span>
              {unit.title}
            </h3>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {unit.lessons.map((lesson) => {
                const stretch = !lesson.completed && !lessonPrerequisiteCheck(engineInput, lesson.id).ready;
                return (
                  <li key={lesson.id}>
                    <Link
                      href={`/child/learn/${lesson.id}`}
                      className={cn(
                        "flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-3xl p-3 text-center shadow-sm transition hover:scale-[1.02]",
                        lesson.completed ? "bg-success-soft" : "bg-surface",
                      )}
                    >
                      <span className="text-4xl" aria-hidden>
                        {lesson.emoji || "📘"}
                      </span>
                      <span className="text-lg leading-tight font-bold">{lesson.title}</span>
                      <span
                        className="text-lg"
                        aria-label={
                          lesson.completed
                            ? `${lesson.bestStars} stars`
                            : stretch
                              ? "A stretch: practise first"
                              : "Not done yet"
                        }
                      >
                        {lesson.completed ? "⭐".repeat(lesson.bestStars) : stretch ? "🧗" : "○"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
