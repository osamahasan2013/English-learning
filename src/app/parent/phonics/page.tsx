import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChildSwitcher } from "@/components/parent/child-switcher";
import { DomainOverviewCard, shortDate } from "@/components/parent/parent-view";
import { SkillBadge } from "@/components/parent/skill-badge";
import { PatternSearchView, readPatternSearch } from "@/components/phonics/pattern-search";
import { Card, CardTitle } from "@/components/ui/card";
import { getProfile } from "@/lib/auth/session";
import { loadChildPhonics, loadLatestPhonicsCheck } from "@/lib/server/phonics";
import { loadDomainOverview, loadFamily } from "@/lib/server/parent-view";

export const metadata: Metadata = { title: "Phonics" };

// Letter NAMES (and shapes) are a separate stage from letter SOUNDS; the page keeps them
// apart so a parent never reads a letter name as a phonics sound (CLAUDE.md rule 9).
const LETTER_NAME_STAGES = new Set(["LETTERS"]);

// Phonics for one of the parent's children (Phase 10): the area overview, progress per
// phonics stage (counts, never an averaged percentage), the latest Phonics Check per area,
// and the pattern search.
export default async function ParentPhonicsPage(props: PageProps<"/parent/phonics">) {
  const params = await props.searchParams;
  const search = readPatternSearch(params);
  const [{ children, child }, profile] = await Promise.all([loadFamily(params.child), getProfile()]);
  if (!child) redirect("/onboarding");
  const timeZone = profile?.timezone ?? "UTC";
  const [overview, phonics, check] = await Promise.all([
    loadDomainOverview(child, "PHONICS"),
    loadChildPhonics(child.id),
    loadLatestPhonicsCheck(child.id),
  ]);
  const groups = [
    {
      key: "names",
      title: "Letter names and shapes",
      help: "Knowing what each letter is called and how it looks (A is called “ay”).",
      stages: phonics.stages.filter((s) => LETTER_NAME_STAGES.has(s.code)),
    },
    {
      key: "sounds",
      title: "Sounds and spelling patterns",
      help: "The sounds letters and letter groups make in words (a as in apple, sh as in ship). These are sounds, not letter names.",
      stages: phonics.stages.filter((s) => !LETTER_NAME_STAGES.has(s.code)),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Phonics</h1>
      <ChildSwitcher kids={children} currentId={child.id} basePath="/parent/phonics" />
      <DomainOverviewCard overview={overview} childId={child.id} childName={child.name} />

      {groups.map((g) => (
        <Card key={g.key} role="region" className="space-y-3" aria-labelledby={`phonics-${g.key}`}>
          <h2 id={`phonics-${g.key}`} className="text-lg font-bold">
            {g.title}
          </h2>
          <p className="text-muted text-sm">{g.help}</p>
          {g.stages.length === 0 ? (
            <p className="text-muted">No stages published yet.</p>
          ) : (
            <ul className="space-y-3">
              {g.stages.map((stage) => {
                const practised = stage.skills.filter((s) => s.status !== "NOT_STARTED");
                return (
                  <li key={stage.code} className="space-y-1">
                    <details>
                      <summary className="cursor-pointer">
                        <span className="font-semibold">
                          <span aria-hidden>{stage.emoji} </span>
                          {stage.name}
                        </span>
                        <span className="text-muted text-sm">
                          {" "}
                          · {stage.mastered} of {stage.skills.length} mastered · {practised.length} practised
                        </span>
                      </summary>
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {stage.skills.map((s) => (
                          <li key={s.skillId} className="flex items-center gap-2 text-sm">
                            <span className="font-semibold">{s.patternLabel ?? s.title}</span>
                            <SkillBadge status={s.status} />
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ))}

      <Card className="space-y-3">
        <CardTitle>Latest Phonics Check</CardTitle>
        {check ? (
          <>
            <p className="text-muted text-sm">
              Taken {shortDate(check.takenAt, timeZone)}. A snapshot of one day.
            </p>
            <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {check.areas.map((a) => (
                <li key={a.label}>
                  <span aria-hidden>{a.secure ? "✅ " : "🔸 "}</span>
                  {a.label}: {a.secure ? "secure" : "not yet secure"}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-muted">No Phonics Check yet. It can be started from Checks.</p>
        )}
      </Card>

      <section aria-labelledby="patterns" className="space-y-3">
        <h2 id="patterns" className="text-2xl font-bold">
          Phonics patterns
        </h2>
        <p className="text-muted max-w-2xl">
          The letter patterns your child learns, the sounds they make, and example words. Search for a pattern
          like <strong>sh</strong> or filter by type (digraphs, vowel teams, magic e…).
        </p>
        <PatternSearchView basePath="/parent/phonics" search={search} />
      </section>
    </div>
  );
}
