import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import { PatternSearchView, readPatternSearch } from "@/components/phonics/pattern-search";
import { Card, CardTitle } from "@/components/ui/card";
import { loadContentFlags } from "@/lib/server/phonics";

export const metadata: Metadata = { title: "Phonics" };

export default async function AdminPhonicsPage(props: PageProps<"/admin/phonics">) {
  // Checked here too, not only in the layout (layouts are not re-run on every navigation).
  await requireAdmin();
  const search = readPatternSearch(await props.searchParams);
  const flags = await loadContentFlags();
  return (
    <>
      <h1 className="text-3xl font-extrabold">Phonics</h1>
      <Card className="space-y-2">
        <CardTitle>Needs review ({flags.length})</CardTitle>
        {flags.length === 0 ? (
          <p className="text-muted">The last import found nothing questionable.</p>
        ) : (
          <ul className="divide-border divide-y text-sm">
            {flags.map((f) => (
              <li key={`${f.entity}-${f.entity_key}-${f.rule}`} className="py-2">
                <span className="font-semibold">
                  {f.entity} “{f.entity_key}”
                </span>{" "}
                <span className="text-muted">
                  ({f.rule}, {f.severity})
                </span>
                <span className="block">{f.message}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted text-sm">
          Flags come from <code>npm run content:import</code>: fix the content file and re-import to clear
          them.
        </p>
      </Card>
      <PatternSearchView basePath="/admin/phonics" search={search} showStatus />
    </>
  );
}
