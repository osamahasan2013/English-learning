import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActivityChart } from "@/components/parent/activity-chart";
import { EnterChildModeButton } from "@/components/parent/enter-child-mode-button";
import { SkillBadge } from "@/components/parent/skill-badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { getProfile } from "@/lib/auth/session";
import { avatarEmoji } from "@/lib/avatars";
import { listChildren, listDimensionNames, loadChildProgress } from "@/lib/server/family-data";
import { loadChildPhonics, loadLatestPhonicsCheck } from "@/lib/server/phonics";
import { loadVocabularyReport } from "@/lib/server/vocabulary";
import { VocabularySummaryCard } from "@/components/parent/vocabulary-report";
import { SpellingSummaryCard } from "@/components/parent/spelling-report";
import { loadSpellingReport } from "@/lib/server/spelling";
import { ageFromDateOfBirth, cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage(props: PageProps<"/parent/dashboard">) {
  const { child: childParam, password } = await props.searchParams;
  const [children, profile] = await Promise.all([listChildren(), getProfile()]);
  if (children.length === 0) redirect("/onboarding");

  const child = children.find((c) => c.id === childParam) ?? children[0];
  const timeZone = profile?.timezone ?? "UTC";
  const [progress, dimensionNames, phonics, phonicsCheck, vocabulary, spelling] = await Promise.all([
    loadChildProgress(child.id, timeZone, new Date(), child.current_level_id),
    listDimensionNames(),
    loadChildPhonics(child.id),
    loadLatestPhonicsCheck(child.id),
    loadVocabularyReport(child.id),
    loadSpellingReport(child.id),
  ]);
  const phonicsStarted = phonics.stages.filter((s) => s.started > 0);
  const age = ageFromDateOfBirth(child.date_of_birth);

  return (
    <div className="space-y-6">
      {password === "updated" ? <Alert tone="success">Your password was changed.</Alert> : null}
      {children.length > 1 ? (
        <nav aria-label="Choose a child" className="flex flex-wrap gap-2">
          {children.map((c) => (
            <Link
              key={c.id}
              href={`/parent/dashboard?child=${c.id}`}
              aria-current={c.id === child.id ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-full border-2 px-4 font-semibold",
                c.id === child.id ? "border-primary bg-accent-soft" : "border-border bg-surface",
              )}
            >
              <span aria-hidden>{avatarEmoji(c.avatar)}</span> {c.name}
            </Link>
          ))}
          <Link
            href="/parent/children/new"
            className="border-border flex min-h-11 items-center rounded-full border-2 border-dashed px-4 font-semibold"
          >
            + Add
          </Link>
        </nav>
      ) : null}

      <section className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="text-6xl" aria-hidden>
            {avatarEmoji(child.avatar)}
          </span>
          <div>
            <h1 className="text-3xl font-extrabold">{child.name}</h1>
            <p className="text-muted">
              {child.grade?.name}
              {child.level && child.level.id !== child.grade?.id ? ` · learning at ${child.level.name}` : ""}
              {age !== null ? ` · ${age} years old` : ""} · {child.daily_minutes} min a day
            </p>
          </div>
        </div>
        <EnterChildModeButton childId={child.id} name={child.name} />
      </section>

      <section aria-label="Summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Lessons completed" value={progress.lessonsCompleted} icon="📘" />
        <Stat
          label="Minutes this week"
          value={progress.minutesThisWeek}
          icon="⏱️"
          note={`${progress.minutesThisMonth} in the last 30 days`}
        />
        <Stat
          label="Day streak"
          value={progress.streak}
          icon="🔥"
          note={`${progress.activeDaysThisWeek} of 7 days active`}
        />
        <Stat
          label="Words learned"
          value={progress.wordsLearned}
          icon="📚"
          note={`${progress.wordsSaved} in My Words · ${progress.stars} ⭐`}
        />
      </section>

      <section aria-label="Learning summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Activities completed" value={progress.activitiesCompleted} icon="🧩" />
        <Stat
          label="Average score"
          value={progress.averageScore}
          icon="🎯"
          note="% right first time, per lesson"
        />
        <Stat
          label="Learning time (min)"
          value={progress.learningMinutes}
          icon="🕒"
          note={`${progress.sessionsCount} learning ${progress.sessionsCount === 1 ? "session" : "sessions"}`}
        />
        <Stat
          label="Skills mastered"
          value={progress.levelProgress.skillsMastered}
          icon="🏆"
          note={`of ${progress.levelProgress.skillsTotal} at ${child.level?.name ?? "this level"}`}
        />
      </section>

      <Card className="space-y-4">
        <CardTitle>Progress by subject · {child.level?.name}</CardTitle>
        {progress.subjectProgress.length === 0 ? (
          <EmptyState icon="🗂️" title="No lessons at this level yet" />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {progress.subjectProgress.map((subject) => (
              <li key={subject.subjectId} className="space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">
                    <span aria-hidden>{subject.emoji} </span>
                    {subject.name}
                  </span>
                  <span className="text-muted text-sm">
                    {subject.lessonsCompleted}/{subject.lessonsTotal} lessons
                    {subject.lessonsCompleted > 0 ? ` · ${Math.round(subject.score)}% avg` : ""}
                  </span>
                </div>
                <ProgressBar
                  value={subject.lessonsCompleted}
                  max={Math.max(1, subject.lessonsTotal)}
                  label={`${subject.name} lessons completed`}
                  tone={subject.status === "COMPLETED" ? "success" : "accent"}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-4 lg:col-span-2">
          <CardTitle>Daily learning time</CardTitle>
          <ActivityChart days={progress.activity14} dailyGoal={child.daily_minutes} />
        </Card>

        <Card className="space-y-3">
          <CardTitle>What to practise next</CardTitle>
          {progress.recommendations.length > 0 ? (
            <ul className="space-y-2">
              {progress.recommendations.map((r) => (
                <li key={r.skill.skillId} className="bg-warning-soft rounded-xl p-3">
                  <p className="text-warning font-bold">{r.message}</p>
                  <p className="text-muted text-sm">
                    {Math.round(r.skill.masteryScore)}% recently, over {r.skill.attempts} answers. It will
                    come up more often in
                    {` ${child.name}'s`} daily review.
                  </p>
                </li>
              ))}
            </ul>
          ) : progress.skills.length === 0 ? (
            <p className="text-muted">Recommendations appear after {child.name} completes a few lessons.</p>
          ) : (
            <p className="text-muted">
              Nothing is difficult right now. {child.name} can keep going with new lessons.
            </p>
          )}
          {progress.strong.length > 0 ? (
            <div>
              <h3 className="font-semibold">Going well</h3>
              <p className="text-muted">
                {progress.strong
                  .slice(0, 5)
                  .map((s) => s.title)
                  .join(", ")}
              </p>
            </div>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-4 lg:col-span-2">
          <CardTitle>Skills</CardTitle>
          {progress.skills.length === 0 ? (
            <EmptyState icon="🧩" title="No skills practised yet">
              Skills appear after the first lesson.
            </EmptyState>
          ) : (
            <ul className="divide-border divide-y">
              {progress.skills.map((s) => (
                <li key={s.skillId} className="grid gap-2 py-3 sm:grid-cols-[1fr_10rem_auto] sm:items-center">
                  <div>
                    <p className="font-semibold">{s.title}</p>
                    <p className="text-muted text-sm">
                      {s.subject} · {s.attempts} answers · {Math.round(s.accuracy)}% correct overall
                    </p>
                  </div>
                  <ProgressBar
                    value={s.masteryScore}
                    label={`${s.title} mastery`}
                    tone={s.masteryScore >= 80 ? "success" : s.masteryScore >= 60 ? "accent" : "warning"}
                  />
                  <SkillBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="space-y-3">
            <CardTitle>Accuracy by area</CardTitle>
            {progress.accuracyByDimension.length === 0 ? (
              <EmptyState title="No answers yet" />
            ) : (
              <ul className="space-y-3">
                {progress.accuracyByDimension.map((d) => (
                  <li key={d.dimension} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold">{dimensionNames.get(d.dimension) ?? d.dimension}</span>
                      <span>
                        {d.accuracy}% <span className="text-muted">({d.attempts})</span>
                      </span>
                    </div>
                    <ProgressBar
                      value={d.accuracy}
                      label={`${dimensionNames.get(d.dimension) ?? d.dimension} accuracy`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="space-y-3">
            <CardTitle>Assessments</CardTitle>
            {phonicsCheck ? (
              <div className="space-y-2">
                <p className="font-semibold">
                  Phonics Check: {Math.round(phonicsCheck.overall)}%
                  <span className="text-muted ml-2 text-sm font-normal">
                    {new Date(phonicsCheck.takenAt).toLocaleDateString("en-US", {
                      dateStyle: "medium",
                      timeZone,
                    })}
                  </span>
                </p>
                <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                  {phonicsCheck.areas.map((a) => (
                    <li key={a.label} className="flex justify-between gap-2">
                      <span>
                        <span aria-hidden>{a.secure ? "✅" : "🔸"} </span>
                        {a.label}
                        <span className="sr-only">{a.secure ? " (secure)" : " (needs practice)"}</span>
                      </span>
                      <span className="font-semibold">{Math.round(a.percent)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {progress.assessmentResults.length === 0 ? (
              <p className="text-muted">
                No assessments yet. Your child can take the Phonics Check from Phonics → Practice; lesson
                results above already track each skill.
              </p>
            ) : (
              <ul>
                {progress.assessmentResults.map((r) => (
                  <li key={r.id}>
                    {new Date(r.created_at).toLocaleDateString()} — {Math.round(Number(r.overall_score))}%
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Phonics</CardTitle>
          <Link href="/parent/phonics" className="text-primary text-sm font-semibold">
            Browse patterns →
          </Link>
        </div>
        {phonicsStarted.length === 0 ? (
          <p className="text-muted">No phonics practice yet.</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {phonicsStarted.map((stage) => (
              <li key={stage.code} className="space-y-1">
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-semibold">
                    <span aria-hidden>{stage.emoji} </span>
                    {stage.name}
                  </span>
                  <span>
                    {stage.percent}%{" "}
                    <span className="text-muted">
                      ({stage.mastered}/{stage.skills.length} mastered)
                    </span>
                  </span>
                </div>
                <ProgressBar value={stage.percent} label={`${stage.name} mastery`} />
              </li>
            ))}
          </ul>
        )}
        {phonics.practice.length > 0 ? (
          <p className="text-sm">
            <span className="font-semibold">Practise next: </span>
            {phonics.practice.map((s) => s.title).join(", ")}
          </p>
        ) : null}
      </Card>

      <VocabularySummaryCard report={vocabulary} childId={child.id} />
      <SpellingSummaryCard report={spelling} childId={child.id} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>Recent lessons</CardTitle>
          {progress.recentRuns.length === 0 ? (
            <EmptyState icon="📘" title="No lessons yet" />
          ) : (
            <ul className="divide-border divide-y">
              {progress.recentRuns.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span aria-hidden>{r.emoji} </span>
                    <span className="font-semibold">{r.title}</span>
                    <span className="text-muted block text-sm">
                      {new Date(r.completedAt).toLocaleString("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone,
                      })}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="font-semibold">
                      {r.correct}/{r.total}
                    </span>
                    <span className="block text-sm" aria-label={`${r.stars} stars`}>
                      {"⭐".repeat(r.stars)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="space-y-3">
          <CardTitle>Achievements</CardTitle>
          {progress.achievements.length === 0 ? (
            <EmptyState icon="🏅" title="No badges yet">
              Badges appear here as {child.name} earns them.
            </EmptyState>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {progress.achievements.map((a) => (
                <li key={a.code} className="bg-accent-soft text-accent rounded-xl px-3 py-2 font-semibold">
                  <span aria-hidden>{a.emoji} </span>
                  {a.title}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, icon, note }: { label: string; value: number; icon: string; note?: string }) {
  return (
    <Card className="space-y-1 p-4">
      <p className="text-muted text-sm font-semibold">
        <span aria-hidden>{icon} </span>
        {label}
      </p>
      <p className="text-3xl font-extrabold">{value}</p>
      {note ? <p className="text-muted text-xs">{note}</p> : null}
    </Card>
  );
}
