import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { GlyphModel } from "@/features/activities/renderers/glyph-view";
import { loadWritingAdmin } from "@/lib/server/writing";

export const metadata: Metadata = { title: "Writing" };

const LEVELS = ["", "KG1", "KG2", "KG3", "Grade 1", "Grade 2"];
const levelRange = (a: number, b: number) =>
  a === b ? (LEVELS[a] ?? a) : `${LEVELS[a] ?? a}–${LEVELS[b] ?? b}`;

// The writing engine's content: writing skills, the reference handwriting (glyphs) and the
// rubric templates for open writing. Authored in content/writing.json and loaded with
// `npm run content:import`, which validates strokes, stroke order hints, thresholds and
// rubric configuration and flags doubts here.
export default async function AdminWritingPage() {
  const data = await loadWritingAdmin();
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-extrabold">Writing</h1>
      <p className="text-muted max-w-3xl">
        Writing content lives in <code>content/writing.json</code> (skills, glyphs, rubrics) and in the
        curriculum files (writing lessons). Published writing questions:{" "}
        {Object.entries(data.questionCount)
          .map(([type, n]) => `${type} ${n}`)
          .join(" · ")}
        .
      </p>

      <section className="space-y-3" aria-labelledby="skills">
        <h2 id="skills" className="text-2xl font-bold">
          Writing skills
        </h2>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="text-muted border-border border-b">
              <tr>
                <th className="p-3 font-semibold">Skill</th>
                <th className="p-3 font-semibold">Strand</th>
                <th className="p-3 font-semibold">Levels</th>
                <th className="p-3 font-semibold">Curriculum skills</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {data.skills.map((s) => (
                <tr key={s.code}>
                  <td className="p-3 font-semibold">
                    <span aria-hidden>{s.emoji} </span>
                    {s.name} <span className="text-muted font-normal">{s.code}</span>
                  </td>
                  <td className="p-3">{s.strand}</td>
                  <td className="p-3">{levelRange(s.min_level_rank, s.max_level_rank)}</td>
                  <td className="p-3">{s.curriculumSkills || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section className="space-y-3" aria-labelledby="glyphs">
        <h2 id="glyphs" className="text-2xl font-bold">
          Glyphs ({data.glyphs.length})
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {data.glyphs.map(({ row, glyph, flags }) => (
            <li key={row.code}>
              <Link
                href={`/admin/writing/glyphs/${row.code}`}
                className="bg-surface flex flex-col items-center gap-1 rounded-2xl p-3 shadow-sm"
              >
                {glyph ? (
                  <GlyphModel glyph={glyph} size={88} />
                ) : (
                  <span className="text-danger text-sm">Invalid strokes</span>
                )}
                <span className="text-sm font-semibold">{row.name}</span>
                <span className="text-muted text-xs">
                  {row.code} · {glyph?.strokes.length ?? 0} strokes
                  {row.status !== "published" ? ` · ${row.status}` : ""}
                  {flags.length ? ` · ⚠️ ${flags.length}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="rubrics">
        <h2 id="rubrics" className="text-2xl font-bold">
          Rubric templates
        </h2>
        <p className="text-muted max-w-3xl text-sm">
          Critical criteria decide “right” or “not yet”; the others are tips. “level” follows the level&apos;s
          writing rules (off, a hint, or required). Each question adds its own ideas (keyword groups), topic
          or text not to copy.
        </p>
        <ul className="grid gap-3 lg:grid-cols-2">
          {data.rubrics.map((r) => (
            <li key={r.code}>
              <Card className="space-y-2">
                <p className="font-semibold">
                  {r.name} <span className="text-muted font-normal">{r.code}</span>
                </p>
                <p className="text-muted text-sm">
                  {levelRange(r.min_level_rank, r.max_level_rank)} · {r.description}
                </p>
                <ul className="flex flex-wrap gap-1 text-xs">
                  {r.criteria.map((c) => (
                    <li key={c.id} className="bg-surface-muted rounded-full px-2 py-0.5">
                      {c.critical === true ? "● " : c.critical === "level" ? "◐ " : "○ "}
                      {c.label}
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
