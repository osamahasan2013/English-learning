import Link from "next/link";
import { startActivityAsChild } from "@/app/parent/child-actions";
import { SkillBadge } from "@/components/parent/skill-badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import type { Domain } from "@/lib/learning/assessment-blueprint";
import {
  countsText,
  PARENT_MASTERY_TEXT,
  trendText,
  type ActionItem,
  type AttentionNote,
  type DomainSnapshot,
  type DomainState,
  type LevelLine,
  type NoteItem,
  type ParentSkill,
  type RecentItem,
  type Trend,
} from "@/lib/parent/view-model";
import type { DomainOverview } from "@/lib/server/parent-view";
import { cn } from "@/lib/utils";

// Presentation pieces of the parent experience (Phase 10). They render the view model
// (src/lib/parent/view-model.ts) and decide nothing. Every state is written out in words;
// colour and icons only supplement it.

export const DOMAIN_PAGES: Record<Domain, string> = {
  PHONICS: "/parent/phonics",
  VOCABULARY: "/parent/words",
  SPELLING: "/parent/spelling",
  READING: "/parent/reading",
  WRITING: "/parent/writing",
};

const DOMAIN_EMOJI: Record<Domain, string> = {
  PHONICS: "🔊",
  VOCABULARY: "📚",
  SPELLING: "✏️",
  READING: "📖",
  WRITING: "✍️",
};

export const shortDate = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium", timeZone });

// "Learning at" per area, with how much evidence it rests on.
export function LevelsList({ levels }: { levels: LevelLine[] }) {
  return (
    <ul aria-label="Learning at, by area" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {levels.map((l) => (
        <li key={l.domain} className="bg-surface-muted rounded-xl p-3">
          <p className="font-bold">
            <span aria-hidden>{DOMAIN_EMOJI[l.domain]} </span>
            {l.name}
          </p>
          <p>
            <span className="text-muted text-sm">Learning at </span>
            <span className="font-semibold">{l.learningAt}</span>
          </p>
          <p className="text-muted text-xs">{l.evidence}</p>
        </li>
      ))}
    </ul>
  );
}

// A recommendation or plan item with its reason and a Start button (child mode, straight
// into that lesson or re-check).
export function ActionList({
  items,
  childId,
  childName,
  showGuidance,
}: {
  items: (ActionItem & { guidance?: string })[];
  childId: string;
  childName: string;
  showGuidance?: boolean;
}) {
  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li
          key={item.key}
          className={cn(
            "border-border space-y-2 rounded-xl border-2 p-3",
            item.priority === "high" ? "border-warning/60" : "",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-bold">
                <span aria-hidden>{item.emoji} </span>
                {item.title}
              </p>
              <p className="text-muted text-sm font-semibold">
                {item.priority === "high" ? <span aria-hidden>❗ </span> : null}
                {item.priorityLabel} · {item.kindLabel}
                {item.domainName ? ` · ${item.domainName}` : ""} · about {item.minutes} min
              </p>
            </div>
            {item.href ? (
              <form action={startActivityAsChild}>
                <input type="hidden" name="childId" value={childId} />
                <input type="hidden" name="next" value={item.href} />
                <Button type="submit" size="sm" variant="success">
                  ▶ Start
                  <span className="sr-only">
                    {" "}
                    {item.title} as {childName}
                  </span>
                </Button>
              </form>
            ) : null}
          </div>
          <p className="text-sm">
            <span className="font-semibold">Why: </span>
            {item.reason}
          </p>
          {showGuidance && item.guidance ? (
            <p className="bg-accent-soft rounded-lg p-2 text-sm">
              <span className="font-semibold">At home: </span>
              {item.guidance}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function AttentionList({ notes }: { notes: AttentionNote[] }) {
  if (notes.length === 0) return null;
  return (
    <section aria-labelledby="attention-heading" className="bg-accent-soft space-y-2 rounded-2xl p-4">
      <h2 id="attention-heading" className="font-bold">
        Worth knowing
      </h2>
      <ul className="space-y-1">
        {notes.map((n) => (
          <li key={n.key}>
            <span aria-hidden>• </span>
            {n.href ? (
              <Link href={n.href} className="font-semibold underline">
                {n.text}
              </Link>
            ) : (
              n.text
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const STATE_ICON: Record<DomainState, string> = {
  NOT_ENOUGH_EVIDENCE: "○",
  LIMITED_EVIDENCE: "◔",
  NEEDS_REVIEW: "🔁",
  LEARNING: "🌱",
  PRACTICING: "🌿",
  ALMOST_MASTERED: "🌳",
  MASTERED: "⭐",
};

export function DomainSnapshotGrid({
  domains,
  childId,
  trends,
}: {
  domains: DomainSnapshot[];
  childId: string;
  trends?: Record<Domain, Trend>;
}) {
  return (
    <ul aria-label="Progress by area" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {domains.map((d) => (
        <li key={d.domain} className="border-border space-y-1 rounded-xl border-2 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-bold">
              <span aria-hidden>{DOMAIN_EMOJI[d.domain]} </span>
              {d.name}
            </h3>
            <span className="text-sm font-semibold">
              <span aria-hidden>{STATE_ICON[d.state]} </span>
              {d.label}
            </span>
          </div>
          <p className="text-muted text-sm">{d.help}</p>
          {d.practised > 0 ? (
            <p className="text-sm">
              {d.practised} {d.practised === 1 ? "skill" : "skills"} practised ({d.answers} answers)
              {countsText(d.counts) ? `: ${countsText(d.counts)}` : ""}
            </p>
          ) : null}
          {d.toReview.length > 0 ? (
            <p className="text-sm">
              <span className="font-semibold">Coming back for review: </span>
              {d.toReview.slice(0, 3).join(", ")}
            </p>
          ) : null}
          {trends ? <p className="text-sm">{trendText(trends[d.domain])}</p> : null}
          <Link
            href={`${DOMAIN_PAGES[d.domain]}?child=${childId}`}
            className="text-primary inline-block text-sm font-semibold"
          >
            {d.name} progress →
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function NotesList({ items, empty }: { items: NoteItem[]; empty: string }) {
  if (items.length === 0) return <p className="text-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((n) => (
        <li key={`${n.domainName}-${n.title}`}>
          <p className="font-semibold">
            {n.title}
            {n.domainName ? <span className="text-muted text-sm font-normal"> · {n.domainName}</span> : null}
          </p>
          {n.why ? <p className="text-muted text-sm">{n.why}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export function RecentList({ items, timeZone }: { items: RecentItem[]; timeZone: string }) {
  return (
    <ul className="divide-border divide-y">
      {items.map((r) => (
        <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
          <span>
            <span aria-hidden>{r.emoji} </span>
            <span className="font-semibold">{r.title}</span>
            <span className="text-muted block text-sm">{r.detail}</span>
          </span>
          <span className="text-muted text-sm">{shortDate(r.at, timeZone)}</span>
        </li>
      ))}
    </ul>
  );
}

// A domain's skills with their mastery in parent words (label + meaning).
export function SkillsInWords({ skills }: { skills: ParentSkill[] }) {
  if (skills.length === 0) return <p className="text-muted">No skills practised in this area yet.</p>;
  return (
    <ul className="divide-border divide-y">
      {skills.map((s) => (
        <li key={s.skillId} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span>
            <span className="font-semibold">{s.title}</span>
            <span className="text-muted block text-sm">
              {PARENT_MASTERY_TEXT[s.status].meaning} · {s.attempts} {s.attempts === 1 ? "answer" : "answers"}
            </span>
          </span>
          <SkillBadge status={s.status} />
        </li>
      ))}
    </ul>
  );
}

export function ParentHelp({ children }: { children: React.ReactNode }) {
  return (
    <Card className="space-y-2">
      <CardTitle>About these results</CardTitle>
      <div className="text-muted space-y-2 text-sm">{children}</div>
    </Card>
  );
}

// The top of every area page: level, state, trend, the next step for this area, and the
// area's skills in parent words.
export function DomainOverviewCard({
  overview,
  childId,
  childName,
  note,
}: {
  overview: DomainOverview;
  childId: string;
  childName: string;
  note?: React.ReactNode;
}) {
  const { level, snapshot } = overview;
  return (
    <Card role="region" className="space-y-4" aria-labelledby={`overview-${overview.domain}`}>
      <h2 id={`overview-${overview.domain}`} className="text-lg font-bold">
        {childName}&apos;s {snapshot.name.toLowerCase()} at a glance
      </h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="bg-surface-muted rounded-xl p-3">
          <dt className="text-muted font-semibold">Learning at</dt>
          <dd className="text-base font-bold">{level.learningAt}</dd>
          <dd className="text-muted">{level.evidence}</dd>
        </div>
        <div className="bg-surface-muted rounded-xl p-3">
          <dt className="text-muted font-semibold">State</dt>
          <dd className="text-base font-bold">
            <span aria-hidden>{STATE_ICON[snapshot.state]} </span>
            {snapshot.label}
          </dd>
          <dd className="text-muted">{countsText(snapshot.counts) || snapshot.help}</dd>
        </div>
        <div className="bg-surface-muted rounded-xl p-3">
          <dt className="text-muted font-semibold">Trend</dt>
          <dd>{trendText(overview.trend)}</dd>
        </div>
      </dl>
      {note ? <div className="text-muted text-sm">{note}</div> : null}
      <div className="space-y-2">
        <h3 className="font-semibold">Next step in {snapshot.name.toLowerCase()}</h3>
        {overview.next ? (
          <ActionList items={[overview.next]} childId={childId} childName={childName} showGuidance />
        ) : (
          <p className="text-muted text-sm">Nothing to recommend in this area right now.</p>
        )}
      </div>
      <details>
        <summary className="cursor-pointer font-semibold">
          Skills in {snapshot.name.toLowerCase()} ({overview.skills.length})
        </summary>
        <div className="pt-2">
          <SkillsInWords skills={overview.skills} />
        </div>
      </details>
    </Card>
  );
}
