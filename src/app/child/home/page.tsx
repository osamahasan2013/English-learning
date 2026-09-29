import type { Metadata } from "next";
import Link from "next/link";
import { requireActiveChild } from "@/lib/auth/session";
import { loadChildHome } from "@/lib/server/family-data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Home" };

export default async function ChildHomePage() {
  const child = await requireActiveChild();
  const home = await loadChildHome(child);
  const next = home.plan[0];

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-center gap-4">
        <h1 className="text-4xl font-extrabold">Hi, {child.name}!</h1>
        <Link
          href="/child/rewards"
          className="bg-surface ml-auto flex items-center gap-2 rounded-full px-5 py-2 text-2xl font-extrabold shadow-sm"
        >
          <span aria-hidden>⭐</span> {home.stars}
          <span className="sr-only">stars. See my rewards.</span>
        </Link>
      </section>

      {next ? (
        <Link
          href={`/child/learn/${next.lessonId}`}
          className="bg-success flex items-center gap-5 rounded-[2rem] p-6 text-white shadow-lg transition hover:brightness-110"
        >
          <span
            className="flex size-20 shrink-0 items-center justify-center rounded-full bg-white/20 text-5xl"
            aria-hidden
          >
            ▶
          </span>
          <span>
            <span className="block text-lg font-semibold opacity-90">
              {next.kind === "review" ? "Practice" : "Next"}
            </span>
            <span className="block text-3xl font-extrabold">{next.title}</span>
          </span>
        </Link>
      ) : (
        <div className="bg-surface rounded-[2rem] p-6 text-center text-2xl font-bold shadow-sm">
          <span aria-hidden>🎉 </span>You finished everything here!
        </div>
      )}

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
              {unit.lessons.map((lesson) => (
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
                      aria-label={lesson.completed ? `${lesson.bestStars} stars` : "Not done yet"}
                    >
                      {lesson.completed ? "⭐".repeat(lesson.bestStars) : "○"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
