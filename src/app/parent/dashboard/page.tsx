import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChildSwitcher } from "@/components/parent/child-switcher";
import { EnterChildModeButton } from "@/components/parent/enter-child-mode-button";
import {
  ActionList,
  AttentionList,
  DomainSnapshotGrid,
  LevelsList,
  NotesList,
  RecentList,
  shortDate,
} from "@/components/parent/parent-view";
import { Alert } from "@/components/ui/alert";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getProfile } from "@/lib/auth/session";
import { avatarEmoji } from "@/lib/avatars";
import { loadFamily, loadParentDashboard } from "@/lib/server/parent-view";
import { ageFromDateOfBirth } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

// The parent's home (Phase 10): one child at a time, read from the authoritative systems
// through the presentation read-model (src/lib/parent/view-model.ts) — levels per area,
// today's plan and what to practise next (adaptive.ts), recent finished learning, progress
// per area, strengths and needs, and the check status. Details live on Progress, Practice,
// Checks and the area pages.
export default async function DashboardPage(props: PageProps<"/parent/dashboard">) {
  const params = await props.searchParams;
  const [{ children, child }, profile] = await Promise.all([loadFamily(params.child), getProfile()]);
  if (!child) redirect("/onboarding");
  const timeZone = profile?.timezone ?? "UTC";
  const { view, progress } = await loadParentDashboard(child, timeZone);
  const age = ageFromDateOfBirth(child.date_of_birth);
  const q = `?child=${child.id}`;

  return (
    <div className="space-y-6">
      {params.password === "updated" ? <Alert tone="success">Your password was changed.</Alert> : null}
      <ChildSwitcher kids={children} currentId={child.id} basePath="/parent/dashboard" showAdd />

      <section aria-labelledby="child-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="text-6xl" aria-hidden>
              {avatarEmoji(child.avatar)}
            </span>
            <div>
              <h1 id="child-heading" className="text-3xl font-extrabold">
                {child.name}
              </h1>
              <p className="text-muted">
                School grade: {child.grade?.name ?? "not set"}
                {age !== null ? ` · ${age} years old` : ""} · {child.daily_minutes} min a day
              </p>
            </div>
          </div>
          <EnterChildModeButton childId={child.id} name={child.name} />
        </div>
        <LevelsList levels={view.levels} />
        {!view.hasEvidence ? (
          <p className="bg-accent-soft rounded-xl p-3 text-sm">
            No evidence yet, so every area starts at the learning level in {child.name}&apos;s settings. A
            short “Find My Level” check (from{" "}
            <Link href={`/parent/assessments${q}`} className="font-semibold underline">
              Checks and levels
            </Link>
            ) finds where {child.name} should start in each area.
          </p>
        ) : (
          <p className="text-muted text-sm">
            Each area has its own level. It is not a school grade and the school grade never changes because
            of it.
          </p>
        )}
      </section>

      <AttentionList notes={view.attention} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Today</CardTitle>
            {view.today.items.length > 0 ? (
              <span className="text-muted text-sm">
                about {view.today.minutes} of {child.daily_minutes} min
              </span>
            ) : null}
          </div>
          {view.today.nothingUrgent ? (
            <p className="text-sm">
              <span aria-hidden>✅ </span>Nothing urgent right now.
            </p>
          ) : null}
          {view.today.items.length === 0 ? (
            <p className="text-muted">Nothing is planned yet. New lessons appear as content is published.</p>
          ) : (
            <ActionList items={view.today.items} childId={child.id} childName={child.name} />
          )}
        </Card>

        <Card className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>What to practise next</CardTitle>
            <Link href={`/parent/practice${q}`} className="text-primary text-sm font-semibold">
              All practice →
            </Link>
          </div>
          {view.next ? (
            <ActionList items={[view.next]} childId={child.id} childName={child.name} />
          ) : (
            <p className="text-muted">Nothing to recommend yet. Lessons and checks add evidence.</p>
          )}
        </Card>
      </div>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Progress by area</CardTitle>
          <Link href={`/parent/progress${q}`} className="text-primary text-sm font-semibold">
            Full progress →
          </Link>
        </div>
        <DomainSnapshotGrid domains={view.domains} childId={child.id} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>Going well</CardTitle>
          <NotesList
            items={view.strengths}
            empty={`Strengths appear once ${child.name} has secured a skill in lessons or a check.`}
          />
        </Card>
        <Card className="space-y-3">
          <CardTitle>Needs practice</CardTitle>
          <NotesList items={view.needs} empty="Nothing needs extra practice right now." />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>Recent learning</CardTitle>
          {view.recent.length === 0 ? (
            <EmptyState icon="📘" title="No finished lessons yet">
              Finished lessons and checks appear here.
            </EmptyState>
          ) : (
            <RecentList items={view.recent} timeZone={timeZone} />
          )}
        </Card>

        <div className="space-y-6">
          <Card className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <CardTitle>Checks</CardTitle>
              <Link href={`/parent/assessments${q}`} className="text-primary text-sm font-semibold">
                Checks and levels →
              </Link>
            </div>
            {view.assessment.latest ? (
              <p>
                Last check: <span className="font-semibold">{view.assessment.latest.title}</span>,{" "}
                {shortDate(view.assessment.latest.at, timeZone)}
              </p>
            ) : null}
            {view.assessment.waiting > 0 ? (
              <p>
                {view.assessment.waiting === 1 ? "One check is" : `${view.assessment.waiting} checks are`}{" "}
                waiting for {child.name}.
              </p>
            ) : null}
            <p className="text-muted text-sm">{view.assessment.message}</p>
          </Card>

          <Card className="space-y-3">
            <CardTitle>This week</CardTitle>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Fact label="Minutes learning" value={progress.minutesThisWeek} />
              <Fact label="Days active" value={`${progress.activeDaysThisWeek} of 7`} />
              <Fact label="Lessons completed (all time)" value={progress.lessonsCompleted} />
              <Fact label="Words learned (all time)" value={progress.wordsLearned} />
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-surface-muted rounded-xl p-3">
      <dt className="text-muted font-semibold">{label}</dt>
      <dd className="text-2xl font-extrabold">{value}</dd>
    </div>
  );
}
