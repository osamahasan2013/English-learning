import Link from "next/link";
import { SkillBadge } from "@/components/parent/skill-badge";
import { Card, CardTitle } from "@/components/ui/card";
import type { loadReadingReport } from "@/lib/server/reading";

// A parent's view of their child's reading, from stored history only: reading lessons
// completed, reading skills learning and mastered, comprehension (first tries on questions
// about texts) by skill, words the child tapped for help, recent reading and what to read
// next. Reading speed and reading-aloud accuracy are not shown: nothing measures them.

export type ReadingReport = Awaited<ReturnType<typeof loadReadingReport>>;

function Figure({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="bg-surface-muted rounded-2xl p-3">
      <p className="text-2xl font-extrabold">
        <span aria-hidden>{icon} </span>
        {value}
      </p>
      <p className="text-muted text-sm font-semibold">{label}</p>
    </div>
  );
}

const MODE_LABELS: Record<string, string> = {
  listen_first: "Listened, then read",
  read_first: "Read on their own",
  reread: "Read again",
};
const SELF_CHECK: Record<string, string> = { easy: "😀 easy", ok: "🙂 OK", hard: "😕 hard" };

function minutes(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)} min`;
}

export function ReadingSummaryCard({ report, childId }: { report: ReadingReport; childId: string }) {
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>Reading</CardTitle>
        <Link href={`/parent/reading?child=${childId}`} className="text-primary text-sm font-semibold">
          Reading progress →
        </Link>
      </div>
      {report.summary.readings === 0 && report.comprehension.firstTries === 0 ? (
        <p className="text-muted">No reading yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="Texts read" value={report.summary.texts} icon="📖" />
          <Figure label="Reading lessons done" value={report.lessonsCompleted} icon="✅" />
          <Figure
            label="Questions right first time"
            value={report.comprehension.percent === null ? "—" : `${report.comprehension.percent}%`}
            icon="🎯"
          />
          <Figure label="Words tapped for help" value={report.helpWords.length} icon="🔎" />
        </div>
      )}
    </Card>
  );
}

export function ReadingReportView({ report }: { report: ReadingReport }) {
  const empty = report.summary.readings === 0 && report.comprehension.firstTries === 0;
  return (
    <div className="space-y-6">
      {empty ? (
        <Card>
          <p className="text-muted">
            No reading yet. Progress appears here once your child reads a story in a reading lesson.
          </p>
        </Card>
      ) : (
        <section aria-label="Reading totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure
            label={`Reading lessons done (of ${report.textsAvailable})`}
            value={report.lessonsCompleted}
            icon="✅"
          />
          <Figure label="Times reading a text" value={report.summary.readings} icon="📖" />
          <Figure label="Time with texts" value={minutes(report.summary.totalSeconds)} icon="⏱️" />
          <Figure
            label="Questions right first time"
            value={
              report.comprehension.percent === null
                ? "—"
                : `${report.comprehension.percent}% (${report.comprehension.correct}/${report.comprehension.firstTries})`
            }
            icon="🎯"
          />
        </section>
      )}

      <Card className="space-y-3">
        <CardTitle>Reading skills</CardTitle>
        <p className="text-muted text-sm">
          {report.learning} learning · {report.mastered} mastered. Mastery comes from answers to questions
          about texts; reading fluency is shown as re-reading and help taps only — no speed or pronunciation
          score is measured.
        </p>
        {report.skills.length === 0 ? (
          <p className="text-muted">No reading skills yet.</p>
        ) : (
          <ul className="divide-border divide-y">
            {report.skills.map((s) => (
              <li key={s.code} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto_10rem] sm:items-center">
                <span className="font-semibold">{s.name}</span>
                <SkillBadge status={s.status} />
                <span className="text-muted text-sm">
                  {s.comprehension
                    ? `${s.comprehension.correct}/${s.comprehension.firstTries} right first time`
                    : "No questions yet"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>Difficult words</CardTitle>
          <p className="text-muted text-sm">
            Words your child tapped to hear while reading (most taps first).
          </p>
          {report.helpWords.length === 0 ? (
            <p className="text-muted">None yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {report.helpWords.map((w) => (
                <li key={w.wordId} className="bg-surface-muted rounded-full px-3 py-1 font-semibold">
                  {w.emoji ? <span aria-hidden>{w.emoji} </span> : null}
                  {w.word} <span className="text-muted text-sm">×{w.taps}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-3">
          <CardTitle>Read next</CardTitle>
          {report.recommended.length === 0 ? (
            <p className="text-muted">
              All texts at this level are read. New texts appear as they are added.
            </p>
          ) : (
            <ul className="space-y-2">
              {report.recommended.map((r) => (
                <li key={r.storyId} className="flex items-center gap-2">
                  <span aria-hidden>{r.item.emoji}</span>
                  <span className="font-semibold">{r.item.title}</span>
                  <span className="text-muted text-sm">
                    {r.reason === "reread"
                      ? "— read again: some questions were hard"
                      : r.reason === "stretch"
                        ? "— a step up to the next level"
                        : "— next at this level"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="space-y-3">
        <CardTitle>Recent reading</CardTitle>
        {report.recent.length === 0 ? (
          <p className="text-muted">Nothing yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Text</th>
                  <th className="py-2 pr-3 font-semibold">How</th>
                  <th className="py-2 pr-3 font-semibold">Time</th>
                  <th className="py-2 pr-3 font-semibold">Listens</th>
                  <th className="py-2 pr-3 font-semibold">Re-reads</th>
                  <th className="py-2 pr-3 font-semibold">Help taps</th>
                  <th className="py-2 font-semibold">Felt</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {report.recent.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 font-semibold">
                      <span aria-hidden>{r.emoji} </span>
                      {r.title}
                      <span className="text-muted block text-xs font-normal">
                        {new Date(r.startedAt).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{MODE_LABELS[r.mode] ?? r.mode}</td>
                    <td className="py-2 pr-3">{minutes(r.seconds)}</td>
                    <td className="py-2 pr-3">{r.listens}</td>
                    <td className="py-2 pr-3">{r.rereads}</td>
                    <td className="py-2 pr-3">{r.helpTaps}</td>
                    <td className="py-2">{r.selfCheck ? SELF_CHECK[r.selfCheck] : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
