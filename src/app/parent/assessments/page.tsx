import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cancelCheck, startCheckForChild } from "@/app/parent/assessment-actions";
import { ReadinessGrid, SittingHistory } from "@/components/parent/assessment-report";
import { ChildSwitcher } from "@/components/parent/child-switcher";
import { ActionList, ParentHelp } from "@/components/parent/parent-view";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { getProfile } from "@/lib/auth/session";
import { DOMAIN_NAMES, DOMAINS } from "@/lib/learning/assessment-blueprint";
import { loadAdaptive } from "@/lib/server/adaptive";
import {
  ASSESSMENT_TYPE_NAMES,
  listAvailableChecks,
  loadOpenSittings,
  loadSittingHistory,
} from "@/lib/server/assessments";
import { practiceView } from "@/lib/parent/view-model";
import { loadFamily } from "@/lib/server/parent-view";

export const metadata: Metadata = { title: "Checks and levels" };

// Assessments for one of the parent's children (Phase 9): instructional level per area with
// its evidence and confidence, recommended next steps with their reasons, checks to start or
// cancel, and the history of past checks. All reads go through the parent's RLS client.
export default async function ParentAssessmentsPage(props: PageProps<"/parent/assessments">) {
  const params = await props.searchParams;
  const [{ children, child }, profile] = await Promise.all([loadFamily(params.child), getProfile()]);
  if (!child) redirect("/onboarding");
  const timeZone = profile?.timezone ?? "UTC";
  const [adaptive, open, history, checks] = await Promise.all([
    loadAdaptive(child.id),
    loadOpenSittings(child.id),
    loadSittingHistory(child.id),
    listAvailableChecks(),
  ]);
  const placementDone = history.some((h) => h.type === "placement" && h.status === "completed");
  const flag = (name: string) => params[name] === "1";
  const next = practiceView(adaptive.recommendations);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Checks and levels</h1>
      <ChildSwitcher kids={children} currentId={child.id} basePath="/parent/assessments" />
      {flag("started") ? (
        <Alert tone="success">The check is ready. {child.name} will find it on their home screen.</Alert>
      ) : null}
      {flag("waiting") ? (
        <Alert tone="info">This check is already waiting for {child.name}; it was not started twice.</Alert>
      ) : null}
      {flag("cancelled") ? (
        <Alert tone="success">The check was cancelled. Answers already given still count as practice.</Alert>
      ) : null}
      {flag("unavailable") ? (
        <Alert tone="error">That check is not available right now. Nothing was changed.</Alert>
      ) : null}

      <Card className="space-y-3">
        <CardTitle>Where {child.name} is working</CardTitle>
        <p className="text-muted text-sm">
          Each area has its own level, decided from checks and lesson practice. The school grade (
          {child.grade?.name ?? "not set"}) never changes because of a check. The evidence label says how much
          a level rests on — how many answers and skills — from &ldquo;Not enough evidence yet&rdquo; to
          &ldquo;Strong evidence&rdquo;. It is not a test score.
        </p>
        <ReadinessGrid
          readiness={adaptive.readiness}
          gradeName={child.grade?.name ?? null}
          timeZone={timeZone}
          detailed
        />
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Recommended next steps</CardTitle>
          <Link href={`/parent/practice?child=${child.id}`} className="text-primary text-sm font-semibold">
            All practice →
          </Link>
        </div>
        {adaptive.recommendations.length === 0 ? (
          <p className="text-muted">Nothing to recommend yet. Lessons and checks add evidence.</p>
        ) : (
          <ActionList
            items={[next.top!, ...next.options.slice(0, 2)]}
            childId={child.id}
            childName={child.name}
          />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>Waiting checks</CardTitle>
          {open.length === 0 ? (
            <p className="text-muted">No check is waiting.</p>
          ) : (
            <ul className="divide-border divide-y">
              {open.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span>
                    <span aria-hidden>{s.emoji} </span>
                    <span className="font-semibold">{s.title}</span>
                    <span className="text-muted block text-sm">
                      {ASSESSMENT_TYPE_NAMES[s.type]} · {s.answered} of {s.items} answered
                    </span>
                  </span>
                  <form action={cancelCheck}>
                    <input type="hidden" name="childId" value={child.id} />
                    <input type="hidden" name="attemptId" value={s.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      Cancel check
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-3">
          <CardTitle>Start a check</CardTitle>
          {!placementDone ? (
            <p className="bg-accent-soft rounded-xl p-3 text-sm">
              <span className="font-semibold">Tip:</span> “Find My Level” is a short placement check. It finds
              where {child.name} should start in each area.
            </p>
          ) : null}
          {checks.length === 0 ? (
            <EmptyState icon="🎯" title="No checks are published yet" />
          ) : (
            <ul className="space-y-3">
              {checks.map((c) => (
                <li key={c.code}>
                  <form action={startCheckForChild} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="childId" value={child.id} />
                    <input type="hidden" name="code" value={c.code} />
                    <div className="min-w-48 flex-1">
                      <p className="font-semibold">{c.title}</p>
                      <p className="text-muted text-sm">
                        {ASSESSMENT_TYPE_NAMES[c.type]}
                        {c.domains.length > 0 ? ` · ${c.domains.map((d) => d.name).join(", ")}` : ""}
                      </p>
                    </div>
                    {c.needsDomain ? (
                      <label className="text-sm">
                        <span className="sr-only">Area for {c.title}</span>
                        <Select name="domain" defaultValue="" required>
                          <option value="" disabled>
                            Choose an area
                          </option>
                          {(c.domains.length > 0 ? c.domains.map((d) => d.code) : DOMAINS).map((d) => (
                            <option key={d} value={d}>
                              {DOMAIN_NAMES[d]}
                            </option>
                          ))}
                        </Select>
                      </label>
                    ) : null}
                    <Button type="submit" size="sm">
                      Start
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="space-y-3">
        <CardTitle>Check history</CardTitle>
        {history.length === 0 ? (
          <EmptyState icon="📋" title="No checks yet">
            Results appear here after {child.name} takes a check.
          </EmptyState>
        ) : (
          <SittingHistory entries={history} timeZone={timeZone} />
        )}
      </Card>

      <ParentHelp>
        <p>
          A check is a short snapshot of what {child.name} answered on one day. It is not a school grade and
          not an IQ test, and it says nothing medical or psychological.
        </p>
        <p>
          Levels differ by area: a child can be learning at one level in phonics and another in writing. That
          is normal. “Not enough evidence yet” or “Limited evidence” means more answers are needed before the
          level can move; until then lessons stay at the learning level you set.
        </p>
        <p>
          “I don&apos;t know” is a fine answer: it helps the check stop where things get too hard, and the
          child is never told it was wrong. It scores as not yet known, and only answered questions count
          toward how much evidence a level rests on. Checks give no feedback, so one lower result is not a
          step back: lesson practice keeps adding evidence too.
        </p>
      </ParentHelp>
    </div>
  );
}
