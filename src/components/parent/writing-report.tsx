import Link from "next/link";
import { SkillBadge } from "@/components/parent/skill-badge";
import { Card, CardTitle } from "@/components/ui/card";
import type { CheckTally } from "@/lib/learning/writing-report";
import type { WritingReport } from "@/lib/server/writing";

// A parent's view of their child's writing, from stored answers only. Open writing is
// checked by simple, fixed rules (enough words and sentences, the ideas asked for, capital
// letters, spaces, end marks); the checks do not understand meaning, so the child's own
// words are shown next to them. These are learning checks, not school grades.

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

const share = (t: CheckTally) => (t.checked === 0 ? "—" : `${t.met} of ${t.checked}`);
const MECHANIC_LABELS = {
  capitalization: { label: "Capital letters", icon: "🔠" },
  spacing: { label: "Spaces between words", icon: "␣" },
  punctuation: { label: "End marks", icon: "⏺" },
} as const;
const KIND_LABELS: Record<string, string> = {
  copy: "Copied a sentence",
  complete: "Finished a sentence",
  edit: "Corrected a sentence",
  rubric: "Own writing",
  story: "Story writing",
};

export function WritingSummaryCard({ report, childId }: { report: WritingReport; childId: string }) {
  const s = report.summary;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>Writing</CardTitle>
        <Link href={`/parent/writing?child=${childId}`} className="text-primary text-sm font-semibold">
          Writing progress →
        </Link>
      </div>
      {s.firstTries === 0 ? (
        <p className="text-muted">No writing yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="Writing answers" value={s.firstTries} icon="✍️" />
          <Figure
            label="Letters formed"
            value={share({ checked: s.handwriting.drawn + s.handwriting.typed, met: s.handwriting.formed })}
            icon="🔤"
          />
          <Figure label="Words in own writing" value={s.wordsWritten} icon="📝" />
          <Figure label="Letters to practise" value={report.lettersToReview.length} icon="🔁" />
        </div>
      )}
    </Card>
  );
}

export function WritingReportView({ report }: { report: WritingReport }) {
  const s = report.summary;
  const empty = s.firstTries === 0;
  return (
    <div className="space-y-6">
      {empty ? (
        <Card>
          <p className="text-muted">
            No writing yet. Progress appears here once your child does a writing lesson.
          </p>
        </Card>
      ) : (
        <section aria-label="Writing totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="Writing answers (first tries)" value={s.firstTries} icon="✍️" />
          <Figure
            label="Right first time"
            value={share({ checked: s.firstTries, met: s.firstTryCorrect })}
            icon="🎯"
          />
          <Figure label="Pieces of own writing" value={s.openPieces} icon="📄" />
          <Figure label="Words in own writing" value={s.wordsWritten} icon="📝" />
        </section>
      )}

      <Card className="space-y-3">
        <CardTitle>Writing skills at this level</CardTitle>
        {report.skills.length === 0 ? (
          <p className="text-muted">No writing skills for this level yet.</p>
        ) : (
          <ul className="divide-border divide-y">
            {report.skills.map((sk) => (
              <li key={sk.code} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-semibold">
                  <span aria-hidden>{sk.emoji} </span>
                  {sk.name}
                </span>
                <span className="flex items-center gap-2">
                  {sk.attempts > 0 ? <span className="text-muted text-sm">{sk.attempts} answers</span> : null}
                  <SkillBadge status={sk.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!empty ? (
        <Card className="space-y-3">
          <CardTitle>Capitals, spaces and end marks</CardTitle>
          <p className="text-muted text-sm">
            How often each was right when it was checked. Younger levels check fewer of them, so a dash means
            it was not checked yet.
          </p>
          <ul className="grid gap-3 sm:grid-cols-3">
            {(Object.keys(MECHANIC_LABELS) as (keyof typeof MECHANIC_LABELS)[]).map((m) => (
              <li key={m}>
                <Figure
                  label={MECHANIC_LABELS[m].label}
                  value={share(s.mechanics[m])}
                  icon={MECHANIC_LABELS[m].icon}
                />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {s.handwriting.drawn + s.handwriting.typed > 0 ? (
        <Card className="space-y-3">
          <CardTitle>Handwriting</CardTitle>
          <p className="text-muted text-sm">
            Letters are checked against a model letter with a tolerance: did the strokes cover the letter,
            stay on it, and start in the right place. This is not handwriting recognition.
            {s.handwriting.typed > 0 ? ` ${s.handwriting.typed} letter(s) were typed instead of drawn.` : ""}
          </p>
          <ul className="flex flex-wrap gap-2">
            {s.handwriting.letters.slice(0, 16).map((l) => (
              <li key={l.glyph} className="bg-surface-muted rounded-2xl px-3 py-1 text-sm font-semibold">
                {l.glyph.replace(/^(lower|upper|digit|shape)-/, "")}: {l.formed} of {l.tries}
              </li>
            ))}
          </ul>
          {report.lettersToReview.length > 0 ? (
            <p className="font-semibold">
              <span aria-hidden>🔁 </span>Coming back for practice:{" "}
              {report.lettersToReview.map((l) => l.name || l.character).join(", ")}
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card className="space-y-3">
        <CardTitle>Recent writing</CardTitle>
        {s.samples.length === 0 ? (
          <p className="text-muted">Nothing written yet.</p>
        ) : (
          <ul className="space-y-4">
            {s.samples.map((w, i) => (
              <li key={i} className="border-border space-y-2 rounded-2xl border p-3">
                <p className="text-muted text-sm">
                  {KIND_LABELS[w.kind] ?? "Writing"} · {new Date(w.attemptedAt).toLocaleDateString()}
                  {w.prompt ? ` · “${w.prompt}”` : ""}
                </p>
                <blockquote className="bg-surface-muted rounded-xl p-3 text-lg whitespace-pre-line">
                  {w.text}
                </blockquote>
                <ul className="flex flex-wrap gap-2 text-sm">
                  {w.criteria.map((c, j) => (
                    <li key={j} className="bg-surface rounded-full border px-2.5 py-0.5">
                      <span aria-hidden>
                        {c.met === true ? "✅ " : c.met === false ? (c.critical ? "🔸 " : "💡 ") : "➖ "}
                      </span>
                      {c.label}
                      <span className="sr-only">
                        {c.met === true ? " — met" : c.met === false ? " — not yet" : " — not checked"}
                      </span>
                    </li>
                  ))}
                </ul>
                {w.misspelled.length > 0 ? (
                  <p className="text-sm">
                    Spelling to look at:{" "}
                    {w.misspelled.map((m) => `${m.written} → ${m.suggestion}`).join(", ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted text-sm">
          🔸 a must-have not met yet · 💡 a tip · ➖ not checked. Open writing is checked by simple rules that
          cannot understand meaning: read your child&apos;s words together and talk about them.
        </p>
      </Card>
    </div>
  );
}
