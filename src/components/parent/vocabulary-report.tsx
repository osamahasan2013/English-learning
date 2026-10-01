import Link from "next/link";
import { MASTERY_LABELS } from "@/components/parent/skill-badge";
import { Card, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { MASTERY_STATUSES } from "@/lib/learning/mastery";
import { WORD_AREA_LABELS } from "@/lib/learning/vocabulary";
import type { VocabularyReport } from "@/lib/server/vocabulary";

// What a parent needs to know about their child's words: how many are learned, practised
// and mastered, which kinds of word work or categories are weak (only when there is
// enough evidence), and the latest words — no raw attempt dumps.

function Figure({ label, value, icon }: { label: string; value: number; icon: string }) {
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

export function VocabularySummaryCard({ report, childId }: { report: VocabularyReport; childId: string }) {
  const weak = [
    ...report.areas.filter((a) => a.weak).map((a) => WORD_AREA_LABELS[a.area].label),
    ...report.categories.filter((c) => c.weak).map((c) => c.name),
  ];
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>Words</CardTitle>
        <Link href={`/parent/words?child=${childId}`} className="text-primary text-sm font-semibold">
          Vocabulary progress →
        </Link>
      </div>
      {report.wordsPracticed === 0 ? (
        <p className="text-muted">No word practice yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Words learned" value={report.wordsLearned} icon="📗" />
            <Figure label="Words practised" value={report.wordsPracticed} icon="✍️" />
            <Figure label="Words mastered" value={report.wordsMastered} icon="🏆" />
            <Figure label="In My Words" value={report.savedWords} icon="⭐" />
          </div>
          {weak.length > 0 ? (
            <p className="text-sm">
              <span className="font-semibold">Needs practice: </span>
              {weak.join(", ")}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

export function VocabularyReportView({ report }: { report: VocabularyReport }) {
  if (report.wordsSeen === 0)
    return (
      <Card>
        <p className="text-muted">
          No words yet. Words appear here once your child opens them in Words or answers questions about them.
        </p>
      </Card>
    );
  return (
    <div className="space-y-6">
      <section aria-label="Word totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Words learned" value={report.wordsLearned} icon="📗" />
        <Figure label="Words practised" value={report.wordsPracticed} icon="✍️" />
        <Figure label="Words mastered" value={report.wordsMastered} icon="🏆" />
        <Figure label="In My Words" value={report.savedWords} icon="⭐" />
      </section>

      <Card className="space-y-3">
        <CardTitle>Where the words are</CardTitle>
        <ul className="grid gap-2 sm:grid-cols-5">
          {MASTERY_STATUSES.map((status) => (
            <li key={status} className="bg-surface-muted rounded-xl p-3 text-center">
              <p className="text-2xl font-extrabold">{report.byStatus[status]}</p>
              <p className="text-muted text-sm font-semibold">{MASTERY_LABELS[status].label}</p>
            </li>
          ))}
        </ul>
        <p className="text-muted text-sm">
          A word counts as mastered after several right answers on at least two different days, never from one
          answer.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>Kinds of word work</CardTitle>
          {report.areas.length === 0 ? (
            <p className="text-muted">Not enough answers yet.</p>
          ) : (
            <ul className="space-y-3">
              {report.areas.map((a) => (
                <li key={a.area} className="space-y-1">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="font-semibold">
                      <span aria-hidden>{WORD_AREA_LABELS[a.area].emoji} </span>
                      {WORD_AREA_LABELS[a.area].label}
                      {a.weak ? <span className="text-warning ml-2">needs practice</span> : null}
                    </span>
                    <span>
                      {Math.round(a.accuracy)}% <span className="text-muted">({a.attempts} answers)</span>
                    </span>
                  </div>
                  <ProgressBar value={a.accuracy} label={`${WORD_AREA_LABELS[a.area].label} accuracy`} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-3">
          <CardTitle>Categories practised</CardTitle>
          {report.categories.length === 0 ? (
            <p className="text-muted">None yet.</p>
          ) : (
            <ul className="divide-border divide-y">
              {report.categories.map((c) => (
                <li key={c.code} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-semibold">
                    {c.name}
                    {c.weak ? <span className="text-warning ml-2 text-sm">needs practice</span> : null}
                  </span>
                  <span className="text-sm">
                    {c.practiced} words · {c.mastered} mastered · {Math.round(c.accuracy)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>Words to practise</CardTitle>
          {report.weakWords.length === 0 ? (
            <p className="text-muted">No weak words right now.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {report.weakWords.map((w) => (
                <li key={w.wordId} className="bg-surface-muted rounded-full px-3 py-1 font-semibold">
                  <span aria-hidden>{w.emoji} </span>
                  {w.word} <span className="text-muted text-sm">{Math.round(w.accuracy)}%</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="space-y-3">
          <CardTitle>Recent words</CardTitle>
          {report.recent.length === 0 ? (
            <p className="text-muted">None yet.</p>
          ) : (
            <ul className="divide-border divide-y">
              {report.recent.map((w) => (
                <li key={w.wordId} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-semibold">
                    <span aria-hidden>{w.emoji} </span>
                    {w.word}
                  </span>
                  <span className="text-sm">
                    {MASTERY_LABELS[w.status].label} · {w.correct}/{w.attempts} right
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
