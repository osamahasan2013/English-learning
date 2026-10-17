import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActivityChart } from "@/components/parent/activity-chart";
import { ChildSwitcher } from "@/components/parent/child-switcher";
import { DOMAIN_PAGES, DomainSnapshotGrid, ParentHelp, SkillsInWords } from "@/components/parent/parent-view";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { getProfile } from "@/lib/auth/session";
import { DOMAINS } from "@/lib/learning/assessment-blueprint";
import { EVIDENCE_LABELS } from "@/lib/learning/readiness";
import {
  DOMAIN_STATE_TEXT,
  PARENT_MASTERY_TEXT,
  TREND_MIN_PER_HALF,
  trendText,
} from "@/lib/parent/view-model";
import { loadDomainTrends, loadFamily, loadParentDashboard, toParentSkills } from "@/lib/server/parent-view";

export const metadata: Metadata = { title: "Progress" };

// Progress in detail for one child (Phase 10): each area's level, state, trend and skills
// in parent words, then learning time, lessons per subject and badges. All of it is read
// from the stored progress caches and the adaptive view; nothing is recomputed here.
export default async function ParentProgressPage(props: PageProps<"/parent/progress">) {
  const params = await props.searchParams;
  const [{ children, child }, profile] = await Promise.all([loadFamily(params.child), getProfile()]);
  if (!child) redirect("/onboarding");
  const timeZone = profile?.timezone ?? "UTC";
  const { view, progress, adaptive } = await loadParentDashboard(child, timeZone);
  const skills = toParentSkills(progress.skills);
  const trends = await loadDomainTrends(child.id, skills);
  const other = skills.filter((s) => s.domain === null);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">{child.name}&apos;s progress</h1>
      <ChildSwitcher kids={children} currentId={child.id} basePath="/parent/progress" />

      <Card className="space-y-3">
        <CardTitle>Overview by area</CardTitle>
        <DomainSnapshotGrid domains={view.domains} childId={child.id} trends={trends} />
      </Card>

      {DOMAINS.map((domain) => {
        const snapshot = view.domains.find((d) => d.domain === domain)!;
        const readiness = adaptive.readiness.find((r) => r.domain === domain)!;
        const mine = skills
          .filter((s) => s.domain === domain)
          .sort((a, b) => (b.lastPracticedAt ?? "").localeCompare(a.lastPracticedAt ?? ""));
        return (
          <Card key={domain} role="region" className="space-y-3" aria-labelledby={`area-${domain}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`area-${domain}`} className="text-lg font-bold">
                {snapshot.name}
              </h2>
              <Link
                href={`${DOMAIN_PAGES[domain]}?child=${child.id}`}
                className="text-primary text-sm font-semibold"
              >
                {snapshot.name} details →
              </Link>
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="font-semibold">Learning at</dt>
                <dd>
                  {readiness.teachingLevelName} ({EVIDENCE_LABELS[readiness.confidence].toLowerCase()})
                </dd>
              </div>
              <div>
                <dt className="font-semibold">State</dt>
                <dd>{snapshot.label}</dd>
              </div>
              <div>
                <dt className="font-semibold">Trend</dt>
                <dd>{trendText(trends[domain])}</dd>
              </div>
            </dl>
            <SkillsInWords skills={mine} />
          </Card>
        );
      })}

      {other.length > 0 ? (
        <Card className="space-y-3">
          <CardTitle>Other skills</CardTitle>
          <SkillsInWords skills={other} />
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-4 lg:col-span-2">
          <CardTitle>Daily learning time (last 14 days)</CardTitle>
          <ActivityChart days={progress.activity14} dailyGoal={child.daily_minutes} />
        </Card>
        <Card className="space-y-3">
          <CardTitle>Learning totals</CardTitle>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Fact label="Lessons completed" value={progress.lessonsCompleted} />
            <Fact label="Activities completed" value={progress.activitiesCompleted} />
            <Fact
              label="Learning time (min)"
              value={progress.learningMinutes}
              note={`${progress.sessionsCount} learning ${progress.sessionsCount === 1 ? "session" : "sessions"}`}
            />
            <Fact
              label="Minutes this week"
              value={progress.minutesThisWeek}
              note={`${progress.minutesThisMonth} in the last 30 days`}
            />
            <Fact
              label="Day streak"
              value={progress.streak}
              note={`${progress.activeDaysThisWeek} of 7 days active`}
            />
            <Fact
              label="Average score"
              value={progress.averageScore}
              note="% of lesson answers right first time, averaged over lessons"
            />
          </dl>
        </Card>
      </div>

      <Card className="space-y-4">
        <CardTitle>Lessons by subject · {child.level?.name}</CardTitle>
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
                    {subject.lessonsCompleted} of {subject.lessonsTotal} lessons
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

      <Card className="space-y-3">
        <CardTitle>Badges</CardTitle>
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

      <ParentHelp>
        <p>
          <span className="font-semibold">Skill words.</span>{" "}
          {(["MASTERED", "ALMOST_MASTERED", "PRACTICING", "LEARNING"] as const)
            .map((s) => `${PARENT_MASTERY_TEXT[s].label}: ${PARENT_MASTERY_TEXT[s].meaning.toLowerCase()}.`)
            .join(" ")}{" "}
          Mastery comes from the child&apos;s own first-try answers and is recalculated from them, so it can
          go down as well as up.
        </p>
        <p>
          <span className="font-semibold">Area states.</span> {DOMAIN_STATE_TEXT.NOT_ENOUGH_EVIDENCE.label}:{" "}
          {DOMAIN_STATE_TEXT.NOT_ENOUGH_EVIDENCE.help.toLowerCase()}{" "}
          {DOMAIN_STATE_TEXT.LIMITED_EVIDENCE.label}: {DOMAIN_STATE_TEXT.LIMITED_EVIDENCE.help.toLowerCase()}{" "}
          {DOMAIN_STATE_TEXT.NEEDS_REVIEW.label}: {DOMAIN_STATE_TEXT.NEEDS_REVIEW.help.toLowerCase()}{" "}
          Otherwise the state is what most practised skills in the area currently are.
        </p>
        <p>
          <span className="font-semibold">Trends</span> compare the earlier and the more recent half of the
          latest lesson answers in an area (first tries, last 8 weeks). They appear only with at least{" "}
          {TREND_MIN_PER_HALF * 2} answers, and say nothing about a school grade.
        </p>
      </ParentHelp>
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="bg-surface-muted rounded-xl p-3">
      <dt className="text-muted font-semibold">{label}</dt>
      <dd className="text-2xl font-extrabold">{value}</dd>
      {note ? <dd className="text-muted text-xs">{note}</dd> : null}
    </div>
  );
}
