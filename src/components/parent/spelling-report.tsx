import Link from "next/link";
import { MASTERY_LABELS } from "@/components/parent/skill-badge";
import { Card, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { MASTERY_STATUSES } from "@/lib/learning/mastery";
import { SPELLING_ERROR_LABELS } from "@/lib/learning/spelling";
import type { SpellingReport } from "@/lib/server/spelling";

// A parent's view of their child's spelling, from real attempts: how many words are
// practised and mastered, the kinds of mistakes made (with what they mean), the phonics
// patterns behind them, spelling types and word families, the words to practise and the
// latest answers exactly as the child wrote them.

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

const pct = (n: number) => `${Math.round(n)}%`;

export function SpellingSummaryCard({ report, childId }: { report: SpellingReport; childId: string }) {
  const top = report.errors[0];
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>Spelling</CardTitle>
        <Link href={`/parent/spelling?child=${childId}`} className="text-primary text-sm font-semibold">
          Spelling progress →
        </Link>
      </div>
      {report.wordsPracticed === 0 ? (
        <p className="text-muted">No spelling yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Words spelled" value={report.wordsPracticed} icon="✏️" />
            <Figure label="Words mastered" value={report.wordsMastered} icon="🏆" />
            <Figure label="Right first time" value={pct(report.firstTryAccuracy)} icon="🎯" />
            <Figure label="To review" value={report.toReview.length} icon="🔁" />
          </div>
          {top ? (
            <p className="text-sm">
              <span className="font-semibold">Most common mistake: </span>
              {SPELLING_ERROR_LABELS[top.category].label} ({top.attempts})
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

export function SpellingReportView({ report, basePath }: { report: SpellingReport; basePath: string }) {
  if (report.wordsPracticed === 0 && report.recentAttempts.total === 0)
    return (
      <Card>
        <p className="text-muted">
          No spelling yet. Progress appears here once your child spells words in a lesson, practice or
          dictation.
        </p>
      </Card>
    );
  const { recentAttempts } = report;
  const pages = Math.max(1, Math.ceil(recentAttempts.total / recentAttempts.pageSize));
  return (
    <div className="space-y-6">
      <section aria-label="Spelling totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Words spelled" value={report.wordsPracticed} icon="✏️" />
        <Figure label="Words mastered" value={report.wordsMastered} icon="🏆" />
        <Figure label="Right first time" value={pct(report.firstTryAccuracy)} icon="🎯" />
        <Figure label="Right first time with a hint" value={report.hintedAnswers} icon="💡" />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>Improvement over time</CardTitle>
          <ul className="grid grid-cols-4 gap-2" aria-label="Right first time, by week">
            {report.trend.weeks.map((w) => (
              <li key={w.weeksAgo} className="bg-surface-muted rounded-xl p-2 text-center">
                <p className="text-xl font-extrabold">{w.attempts ? pct(w.accuracy) : "—"}</p>
                <p className="text-muted text-xs font-semibold">
                  {w.weeksAgo === 0
                    ? "This week"
                    : w.weeksAgo === 1
                      ? "Last week"
                      : `${w.weeksAgo} weeks ago`}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-muted text-sm">
            {report.trend.change === null
              ? "Right first time, per week (more weeks of practice show the trend)."
              : report.trend.change >= 0
                ? `Up ${Math.round(report.trend.change)} points since the first week shown.`
                : `Down ${Math.round(-report.trend.change)} points since the first week shown.`}
            {report.trend.averageResponseMs !== null
              ? ` Average answer time: ${(report.trend.averageResponseMs / 1000).toFixed(1)} s.`
              : ""}
          </p>
        </Card>
        <Card className="space-y-3">
          <CardTitle>Recommended practice</CardTitle>
          {report.patterns.length === 0 && report.weakWords.length === 0 && report.toReview.length === 0 ? (
            <p className="text-muted">Keep going with the next spelling lesson.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5">
              {report.patterns[0] ? (
                <li>
                  Practise words with <strong>{report.patterns[0].pattern.replace("_", "–")}</strong> (
                  {report.patterns[0].attempts} recent mistakes) — they are in your child&apos;s review.
                </li>
              ) : null}
              {[...report.toReview, ...report.weakWords].length > 0 ? (
                <li>
                  Spell again:{" "}
                  {[...report.toReview, ...report.weakWords]
                    .filter((w, i, all) => all.findIndex((x) => x.wordId === w.wordId) === i)
                    .slice(0, 5)
                    .map((w) => w.word)
                    .join(", ")}
                  .
                </li>
              ) : null}
            </ul>
          )}
        </Card>
      </div>

      <Card className="space-y-3">
        <CardTitle>Where the words are</CardTitle>
        <ul className="grid gap-2 sm:grid-cols-4">
          {MASTERY_STATUSES.filter((s) => s !== "NOT_STARTED").map((status) => (
            <li key={status} className="bg-surface-muted rounded-xl p-3 text-center">
              <p className="text-2xl font-extrabold">{report.byStatus[status]}</p>
              <p className="text-muted text-sm font-semibold">{MASTERY_LABELS[status].label}</p>
            </li>
          ))}
        </ul>
        <p className="text-muted text-sm">
          A word is mastered when it is spelled right without help, several times, on at least two days.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>Kinds of mistakes</CardTitle>
          {report.errors.length === 0 ? (
            <p className="text-muted">No mistakes recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {report.errors.map((e) => (
                <li key={e.category} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">
                      <span aria-hidden>{SPELLING_ERROR_LABELS[e.category].emoji} </span>
                      {SPELLING_ERROR_LABELS[e.category].label}
                    </span>
                    <span className="text-muted text-sm">
                      {e.attempts} · {pct(e.share)}
                    </span>
                  </div>
                  <ProgressBar
                    value={e.share}
                    label={`${SPELLING_ERROR_LABELS[e.category].label}: ${pct(e.share)}`}
                  />
                  <p className="text-muted text-sm">{SPELLING_ERROR_LABELS[e.category].help}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-3">
          <CardTitle>Sounds behind the mistakes</CardTitle>
          {report.patterns.length === 0 ? (
            <p className="text-muted">No phonics pattern stands out yet.</p>
          ) : (
            <ul className="divide-border divide-y">
              {report.patterns.map((p) => (
                <li key={p.code} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-xl font-extrabold">{p.pattern.replace("_", "–")}</span>
                  <span className="text-muted text-sm">
                    {p.attempts} {p.attempts === 1 ? "mistake" : "mistakes"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted text-sm">
            A sound misspelled again and again goes back to its phonics lesson in the review queue.
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>Spelling types</CardTitle>
          {report.types.length === 0 ? (
            <p className="text-muted">Nothing yet.</p>
          ) : (
            <ul className="space-y-2">
              {report.types.map((t) => (
                <li key={t.code} className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{t.name}</span>
                  <span className="text-muted text-sm">
                    {t.practiced} {t.practiced === 1 ? "word" : "words"} · {t.mastered} mastered ·{" "}
                    {pct(t.accuracy)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="space-y-3">
          <CardTitle>Word families</CardTitle>
          {report.families.length === 0 ? (
            <p className="text-muted">No word-family words spelled yet.</p>
          ) : (
            <ul className="space-y-2">
              {report.families.map((f) => (
                <li key={f.code} className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{f.code}</span>
                  <span className="text-muted text-sm">
                    {f.practiced} {f.practiced === 1 ? "word" : "words"} · {pct(f.accuracy)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="space-y-3">
        <CardTitle>Words to practise</CardTitle>
        {report.weakWords.length === 0 && report.toReview.length === 0 ? (
          <p className="text-muted">Nothing needs extra practice right now.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {[...report.toReview, ...report.weakWords]
              .filter((w, i, all) => all.findIndex((x) => x.wordId === w.wordId) === i)
              .map((w) => (
                <li key={w.wordId} className="bg-surface-muted rounded-full px-3 py-1 font-semibold">
                  <span aria-hidden>{w.emoji} </span>
                  {w.word}
                  <span className="text-muted text-sm"> · {pct(w.accuracy)}</span>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-3">
        <CardTitle>Latest spelling answers</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted">
                <th className="py-2 pr-3 font-semibold">Word</th>
                <th className="py-2 pr-3 font-semibold">Wrote</th>
                <th className="py-2 pr-3 font-semibold">Result</th>
                <th className="py-2 font-semibold">When</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {recentAttempts.rows.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-3 font-semibold">
                    {a.word ? (
                      <>
                        <span aria-hidden>{a.emoji} </span>
                        {a.word}
                      </>
                    ) : (
                      "Sentence"
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono break-all">{a.written || "—"}</td>
                  <td className="py-2 pr-3">
                    {a.correct ? (
                      <span>
                        <span aria-hidden>✓ </span>Right{a.tryNumber > 1 ? ` (try ${a.tryNumber})` : ""}
                        {a.hintsUsed > 0 ? " · hint" : ""}
                      </span>
                    ) : (
                      <span>
                        <span aria-hidden>✗ </span>
                        {a.errorType ? SPELLING_ERROR_LABELS[a.errorType].label : "Not right"}
                      </span>
                    )}
                  </td>
                  <td className="text-muted py-2 whitespace-nowrap">{new Date(a.at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <nav aria-label="Answer pages" className="flex items-center gap-3 text-sm">
            {recentAttempts.page > 1 ? (
              <Link
                href={`${basePath}&page=${recentAttempts.page - 1}`}
                className="text-primary font-semibold"
              >
                ← Newer
              </Link>
            ) : null}
            <span className="text-muted">
              Page {recentAttempts.page} of {pages}
            </span>
            {recentAttempts.page < pages ? (
              <Link
                href={`${basePath}&page=${recentAttempts.page + 1}`}
                className="text-primary font-semibold"
              >
                Older →
              </Link>
            ) : null}
          </nav>
        ) : null}
      </Card>
    </div>
  );
}
