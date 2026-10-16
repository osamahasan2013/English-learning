import type { Metadata } from "next";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAdmin } from "@/lib/auth/session";
import { loadAdminAssessments } from "@/lib/server/admin-assessments";
import { ASSESSMENT_TYPE_NAMES } from "@/lib/server/assessments";
import type { AssessmentType } from "@/lib/learning/assessment-blueprint";

export const metadata: Metadata = { title: "Assessments" };

const POOL_TEXT = {
  authored: "Authored items",
  level: "Lesson questions at the measured level",
  skills: "Lesson questions of the skills being re-checked",
  unit: "Lesson questions of the unit",
  review: "Lesson questions of skills due for review",
} as Record<string, string>;

export default async function AdminAssessmentsPage() {
  // Checked here too, not only in the layout (layouts are not re-run on every navigation).
  await requireAdmin();
  const { assessments, rules } = await loadAdminAssessments();
  return (
    <>
      <h1 className="text-3xl font-extrabold">Assessments</h1>
      <p className="text-muted max-w-3xl">
        Blueprints and item pools from <code>content/assessments.json</code>. The server selects each
        sitting&apos;s items from these pools; exposure shows how often items were answered (counts only).
        Edit the content file and re-import to change anything.
      </p>
      {assessments.length === 0 ? (
        <EmptyState icon="🎯" title="No assessments imported" />
      ) : (
        assessments.map((a) => (
          <Card key={a.id} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <CardTitle>
                {a.blueprint?.emoji ? <span aria-hidden>{a.blueprint.emoji} </span> : null}
                {a.title} <span className="text-muted text-base font-normal">({a.code})</span>
              </CardTitle>
              <span className="text-muted text-sm">
                {ASSESSMENT_TYPE_NAMES[a.type as AssessmentType] ?? a.type} · {a.status} · v{a.version}
              </span>
            </div>
            {a.blueprint ? (
              <p className="text-sm">
                {POOL_TEXT[a.blueprint.pool] ?? a.blueprint.pool} · up to {a.blueprint.maxItems} items ·
                feedback: {a.blueprint.feedback} · skip {a.blueprint.allowSkip ? "allowed" : "not allowed"} ·
                stopping: {a.blueprint.stopping?.rule ?? "none"}
                {a.blueprint.passPercent !== undefined
                  ? ` · pass ${a.blueprint.passPercent}%`
                  : ` · pass ${rules.assessment.sectionPassPercent}% (rule)`}
                {a.domains.length ? ` · ${a.domains.join(", ")}` : ""}
              </p>
            ) : (
              <p className="text-danger text-sm">The blueprint does not parse.</p>
            )}
            <p className="text-sm">
              {a.itemsTotal} authored items · {a.exposure.served} answered at least once ·{" "}
              {a.exposure.answers} first answers in total · most answered item: {a.exposure.maxAnswers}
            </p>
            {a.sections.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-border border-b">
                      <th className="py-1 pr-3">Section</th>
                      <th className="py-1 pr-3">Area</th>
                      <th className="py-1 pr-3">Level</th>
                      <th className="py-1 pr-3">Draw</th>
                      <th className="py-1 pr-3">Pool</th>
                      <th className="py-1 pr-3">Skills</th>
                      <th className="py-1 pr-3">Difficulty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.sections.map((s) => (
                      <tr key={s.code} className="border-border border-b last:border-0">
                        <td className="py-1 pr-3">{s.label}</td>
                        <td className="py-1 pr-3">{s.domain}</td>
                        <td className="py-1 pr-3">{s.level ?? "child's level"}</td>
                        <td className="py-1 pr-3">
                          {s.draw} (≤{s.maxPerSkill}/skill)
                        </td>
                        <td className="py-1 pr-3">
                          {a.blueprint?.pool === "authored" ? s.pool : "lessons"}
                          {s.shortfall ? <span className="text-danger font-semibold"> · too few</span> : null}
                        </td>
                        <td className="py-1 pr-3">{a.blueprint?.pool === "authored" ? s.skills : "—"}</td>
                        <td className="py-1 pr-3">
                          {s.difficulty ? `${s.difficulty.min}–${s.difficulty.max}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {a.flags.length > 0 ? (
              <div>
                <h3 className="font-semibold">Needs review ({a.flags.length})</h3>
                <ul className="text-sm">
                  {a.flags.map((f, i) => (
                    <li key={i}>
                      <span className="text-muted">
                        ({f.rule}, {f.severity})
                      </span>{" "}
                      {f.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        ))
      )}
      <Card className="space-y-2">
        <CardTitle>Effective rules</CardTitle>
        <p className="text-muted text-sm">
          Defaults from <code>src/lib/learning/rules.ts</code>, overridden by the <code>learning_rules</code>{" "}
          table.
        </p>
        <pre className="bg-surface-muted overflow-x-auto rounded-lg p-3 text-xs">
          {JSON.stringify(
            { assessment: rules.assessment, adaptive: rules.adaptive, mastery: rules.mastery },
            null,
            2,
          )}
        </pre>
      </Card>
    </>
  );
}
