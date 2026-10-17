import type { AdaptiveRecommendation, RecommendationKind } from "@/lib/learning/adaptive";
import { EVIDENCE_LABELS } from "@/lib/learning/readiness";
import type { Confidence } from "@/lib/learning/rules";
import type { DomainReadiness } from "@/lib/server/adaptive";
import { ASSESSMENT_TYPE_NAMES, type SittingHistoryEntry } from "@/lib/server/assessments";
import { cn } from "@/lib/utils";

// Parent views of the assessment + adaptive engine (Phase 9): instructional readiness per
// domain, the explainable recommendations, and sitting results. Text first; colour is only
// a supplement (every state is also written out).

// The engine's "confidence" is shown as how much EVIDENCE a level rests on (answers and
// skills counted by a fixed rule) — parents must not read it as a statistical confidence.
const EVIDENCE_HELP =
  "How many answers and skills this level rests on (from checks and lesson practice). It is not a test score.";

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span
      title={EVIDENCE_HELP}
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-xs font-semibold",
        confidence === "HIGH"
          ? "bg-success-soft text-success"
          : confidence === "MEDIUM"
            ? "bg-accent-soft text-accent"
            : "bg-surface-muted text-muted",
      )}
    >
      {EVIDENCE_LABELS[confidence]}
    </span>
  );
}

const SOURCE_TEXT: Record<DomainReadiness["source"], string> = {
  assessment: "from a check",
  mastery: "from lesson practice",
  inferred: "estimated from phonics",
  default: "the learning level set for this child (no evidence yet)",
};

const shortDate = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium", timeZone });

export function ReadinessGrid({
  readiness,
  gradeName,
  timeZone,
  detailed = false,
}: {
  readiness: DomainReadiness[];
  gradeName: string | null;
  timeZone: string;
  detailed?: boolean;
}) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Instructional level by area">
      {readiness.map((r) => (
        <li key={r.domain} className="border-border space-y-2 rounded-xl border-2 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-bold">{r.name}</h3>
            <ConfidenceBadge confidence={r.confidence} />
          </div>
          <p>
            <span className="text-muted text-sm">Learning at </span>
            <span className="font-semibold">{r.teachingLevelName}</span>
            <span className="text-muted text-sm">
              {" "}
              · {r.confident ? SOURCE_TEXT[r.source] : "the learning level set for this child"}
            </span>
          </p>
          {!r.confident && r.source === "assessment" ? (
            <p className="text-muted text-sm">
              The check did not have enough answered questions to place this area, so lessons stay where they
              were.
            </p>
          ) : null}
          {gradeName && r.teachingLevelName !== gradeName ? (
            <p className="text-muted text-sm">School grade stays {gradeName}.</p>
          ) : null}
          {detailed ? (
            <dl className="space-y-1 text-sm">
              {r.strongestLevelName ? (
                <div>
                  <dt className="inline font-semibold">Secure up to: </dt>
                  <dd className="inline">{r.strongestLevelName}</dd>
                </div>
              ) : null}
              {r.evidence.items ? (
                <div>
                  <dt className="inline font-semibold">Evidence: </dt>
                  <dd className="inline">
                    {r.evidence.items} answers across {r.evidence.skills ?? 0} skills
                    {r.evidence.observedAt ? `, ${shortDate(r.evidence.observedAt, timeZone)}` : ""}
                  </dd>
                </div>
              ) : null}
              {r.evidence.reason ? <dd className="text-muted">{r.evidence.reason}</dd> : null}
              {r.strengths.length > 0 ? (
                <div>
                  <dt className="inline font-semibold">Strengths: </dt>
                  <dd className="inline">
                    {r.strengths
                      .slice(0, 4)
                      .map((s) => s.title)
                      .join(", ")}
                  </dd>
                </div>
              ) : null}
              {r.needs.length > 0 ? (
                <div>
                  <dt className="inline font-semibold">Needs practice: </dt>
                  <dd className="inline">
                    {r.needs
                      .slice(0, 4)
                      .map((s) => s.title)
                      .join(", ")}
                  </dd>
                </div>
              ) : null}
              {r.prerequisiteGaps.length > 0 ? (
                <div>
                  <dt className="inline font-semibold">Comes first: </dt>
                  <dd className="inline">
                    {r.prerequisiteGaps
                      .slice(0, 3)
                      .map((g) => `${g.title} (before ${g.forTitle})`)
                      .join(", ")}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : r.needs.length > 0 ? (
            <p className="text-sm">
              <span className="font-semibold">Needs practice: </span>
              {r.needs
                .slice(0, 3)
                .map((s) => s.title)
                .join(", ")}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const KIND_TEXT: Record<RecommendationKind, string> = {
  repair: "Fix first",
  review: "Review",
  continue: "Continue",
  target: "Next lesson",
  reassess: "Re-check",
  stretch: "Stretch",
};

export function RecommendationList({ recommendations }: { recommendations: AdaptiveRecommendation[] }) {
  return (
    <ol className="space-y-2">
      {recommendations.map((r) => (
        <li
          key={r.key}
          className={cn(
            "rounded-xl p-3",
            r.priority === "high"
              ? "bg-warning-soft"
              : r.priority === "medium"
                ? "bg-accent-soft"
                : "bg-surface-muted",
          )}
        >
          <p className="font-bold">
            <span aria-hidden>{r.emoji} </span>
            {r.title}
            <span className="text-muted ml-2 text-sm font-semibold">
              {KIND_TEXT[r.kind]} · {r.priority} priority · ~{r.minutes} min
            </span>
          </p>
          <p className="text-sm">{r.parentMessage}</p>
        </li>
      ))}
    </ol>
  );
}

const STATUS_TEXT: Record<SittingHistoryEntry["status"], string> = {
  in_progress: "In progress",
  completed: "Completed",
  abandoned: "Cancelled",
  expired: "Expired (not finished)",
};

const CHANGE_TEXT: Record<string, string> = {
  improved: "improved",
  declined: "lower",
  same: "about the same",
  new: "first check",
};

export function SittingHistory({ entries, timeZone }: { entries: SittingHistoryEntry[]; timeZone: string }) {
  return (
    <ul className="divide-border divide-y">
      {entries.map((e) => (
        <li key={e.id} className="space-y-2 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold">
              {e.title}
              <span className="text-muted ml-2 text-sm font-normal">
                {ASSESSMENT_TYPE_NAMES[e.type]} · {shortDate(e.startedAt, timeZone)} · {STATUS_TEXT[e.status]}
              </span>
            </p>
            {e.result ? (
              <p className="font-semibold">
                {Math.round(e.result.overall)}%{e.result.partial ? " (partly answered)" : ""}
              </p>
            ) : null}
          </div>
          {e.result && e.result.sections.length > 0 ? (
            <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {e.result.sections.map((s, i) => (
                <li key={`${s.label}-${i}`} className="flex justify-between gap-2">
                  <span>
                    <span aria-hidden>{s.passed ? "✅" : "🔸"} </span>
                    {s.label}
                    <span className="sr-only">{s.passed ? " (passed)" : " (not yet)"}</span>
                  </span>
                  <span className="font-semibold">
                    {s.correct}/{s.items}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {e.result && e.result.evidence.some((x) => x.gap) ? (
            <p className="text-sm">
              <span className="font-semibold">Gaps found: </span>
              {e.result.evidence
                .filter((x) => x.gap)
                .map((x) => x.title)
                .join(", ")}
            </p>
          ) : null}
          {e.result && e.result.comparison.length > 0 ? (
            <p className="text-sm">
              <span className="font-semibold">Compared with before: </span>
              {e.result.comparison
                .map(
                  (c) =>
                    `${c.title} ${c.before === null ? "" : `${Math.round(c.before)}% → `}${Math.round(c.after)}% (${CHANGE_TEXT[c.change] ?? c.change})`,
                )
                .join("; ")}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
