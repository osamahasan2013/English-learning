import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChildSwitcher } from "@/components/parent/child-switcher";
import { ActionList, ParentHelp } from "@/components/parent/parent-view";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { homeGuidance, practiceView } from "@/lib/parent/view-model";
import { loadAdaptive } from "@/lib/server/adaptive";
import { loadFamily } from "@/lib/server/parent-view";

export const metadata: Metadata = { title: "Practice" };

// What to practise (Phase 10): the adaptive engine's recommendations exactly as it ordered
// them (ADR-048 — the one recommender): the top priority, a few other good options, and the
// rest. Each has its reason, a tip for home tied to its skill, and a Start button that hands
// the device to the child straight into it.
export default async function ParentPracticePage(props: PageProps<"/parent/practice">) {
  const params = await props.searchParams;
  const { children, child } = await loadFamily(params.child);
  if (!child) redirect("/onboarding");
  const adaptive = await loadAdaptive(child.id);
  const byKey = new Map(adaptive.recommendations.map((r) => [r.key, r]));
  const practice = practiceView(adaptive.recommendations);
  const withGuidance = <T extends { key: string }>(items: T[]) =>
    items.map((i) => ({ ...i, guidance: homeGuidance(byKey.get(i.key)!) }));
  const nothingUrgent = !adaptive.recommendations.some((r) => r.priority === "high");

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Practice for {child.name}</h1>
      <ChildSwitcher kids={children} currentId={child.id} basePath="/parent/practice" />

      {practice.top === null ? (
        <Card>
          <EmptyState icon="🌱" title="Nothing to recommend yet">
            Recommendations appear as {child.name} does lessons and checks.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="space-y-3">
            <CardTitle>Top priority</CardTitle>
            {nothingUrgent ? (
              <p className="text-sm">
                <span aria-hidden>✅ </span>Nothing urgent right now — this is simply the best next step.
              </p>
            ) : null}
            <ActionList
              items={withGuidance([practice.top])}
              childId={child.id}
              childName={child.name}
              showGuidance
            />
          </Card>

          {practice.options.length > 0 ? (
            <Card className="space-y-3">
              <CardTitle>Other good options</CardTitle>
              <ActionList
                items={withGuidance(practice.options)}
                childId={child.id}
                childName={child.name}
                showGuidance
              />
            </Card>
          ) : null}

          {practice.later.length > 0 ? (
            <Card className="space-y-3">
              <CardTitle>Later</CardTitle>
              <ActionList items={practice.later} childId={child.id} childName={child.name} />
            </Card>
          ) : null}
        </>
      )}

      <ParentHelp>
        <p>
          These come from the same plan {child.name} sees on their home screen, and the order follows fixed
          rules. First: a skill that comes earlier and is not secure yet, a gap a check found, or repeated
          mistakes. Next: lessons started, the next lessons in each area, due reviews and re-checks. When
          there is time: a first look at the next level, or a review of something already mastered. Areas take
          turns so one area does not crowd out the others.
        </p>
        <p>Short, regular practice works better than long sessions. Stop while it is still fun.</p>
      </ParentHelp>
    </div>
  );
}
