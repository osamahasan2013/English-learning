import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TracePlayground } from "@/components/admin/trace-playground";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GlyphModel } from "@/features/activities/renderers/glyph-view";
import { resolveWritingSettings } from "@/lib/learning/writing-evaluation";
import { loadLearningRules } from "@/lib/server/learning-rules";
import { loadAdminGlyph } from "@/lib/server/writing";
import { createClient } from "@/lib/supabase/server";
import { setGlyphStatus, setGlyphThresholds } from "../../actions";

export const metadata: Metadata = { title: "Glyph" };

// One glyph: the model (animated in stroke order), its strokes, thresholds and flags, and a
// pad to try it with each level's settings — the same tracing engine the lesson uses.
export default async function AdminGlyphPage(props: PageProps<"/admin/writing/glyphs/[code]">) {
  const { code } = await props.params;
  const data = await loadAdminGlyph(code);
  if (!data) notFound();
  const rules = await loadLearningRules(await createClient());
  const levels = Object.keys(rules.writing.levels).map((level) => ({
    level,
    settings: resolveWritingSettings(level, rules.writing),
  }));
  const { row, glyph } = data;

  return (
    <div className="space-y-6">
      <Link href="/admin/writing" className="text-primary font-semibold">
        ← Writing
      </Link>
      <h1 className="text-3xl font-extrabold">
        {row.name} <span className="text-muted text-xl font-semibold">{row.code}</span>
      </h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          {glyph ? (
            <GlyphModel glyph={glyph} size={240} animate={1} />
          ) : (
            <p className="text-danger">The stored strokes are invalid.</p>
          )}
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted">Kind</dt>
            <dd>
              {row.kind} · {row.letter_case} · “{row.character}”
            </dd>
            <dt className="text-muted">Strokes</dt>
            <dd>{glyph?.strokes.map((s, i) => `${i + 1}: ${s.points.length} points`).join(", ")}</dd>
            <dt className="text-muted">Family · difficulty</dt>
            <dd>
              {row.family || "—"} · {row.difficulty}
            </dd>
            <dt className="text-muted">Used by</dt>
            <dd>{data.questions} question(s)</dd>
            <dt className="text-muted">Tip</dt>
            <dd>{row.formation_tip || "—"}</dd>
          </dl>
          {data.flags.length > 0 ? (
            <ul className="bg-warning-soft rounded-xl p-3 text-sm">
              {data.flags.map((f, i) => (
                <li key={i}>⚠️ {f}</li>
              ))}
            </ul>
          ) : null}
          <form action={setGlyphStatus} className="flex items-center gap-3">
            <input type="hidden" name="code" value={row.code} />
            <input type="hidden" name="status" value={row.status === "published" ? "draft" : "published"} />
            <span className="text-sm">Status: {row.status}</span>
            <Button type="submit" variant="secondary" size="sm">
              {row.status === "published" ? "Unpublish" : "Publish"}
            </Button>
          </form>
          <form action={setGlyphThresholds} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="code" value={row.code} />
            <label className="text-sm">
              Tolerance (box units)
              <input
                name="tolerance"
                type="number"
                min={2}
                max={40}
                step={0.5}
                defaultValue={Number(row.tolerance)}
                className="border-border block w-28 rounded-lg border px-2 py-1"
              />
            </label>
            <label className="text-sm">
              Completion (0.3–0.98)
              <input
                name="completion"
                type="number"
                min={0.3}
                max={0.98}
                step={0.01}
                defaultValue={Number(row.completion)}
                className="border-border block w-28 rounded-lg border px-2 py-1"
              />
            </label>
            <Button type="submit" size="sm">
              Save
            </Button>
          </form>
        </Card>
        {glyph ? (
          <Card className="space-y-3">
            <h2 className="text-xl font-bold">Try it</h2>
            <TracePlayground glyph={glyph} levels={levels} />
          </Card>
        ) : null}
      </div>
    </div>
  );
}
