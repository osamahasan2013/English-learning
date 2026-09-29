import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Content overview" };

const TABLES = [
  ["levels", "Levels"],
  ["units", "Units"],
  ["skills", "Skills"],
  ["lessons", "Lessons"],
  ["activities", "Activities"],
  ["questions", "Questions"],
  ["phonics_patterns", "Phonics patterns"],
  ["words", "Words"],
  ["sentences", "Sentences"],
  ["stories", "Stories"],
  ["assessments", "Assessments"],
  ["achievements", "Achievements"],
] as const;

export default async function AdminDashboard() {
  const supabase = await createClient();
  const counts = await Promise.all(
    TABLES.map(async ([table, label]) => {
      const [total, published] = await Promise.all([
        supabase.from(table).select("id", { count: "exact", head: true }),
        supabase.from(table).select("id", { count: "exact", head: true }).eq("status", "published"),
      ]);
      return { table, label, total: total.count ?? 0, published: published.count ?? 0 };
    }),
  );
  return (
    <>
      <h1 className="text-3xl font-extrabold">Content overview</h1>
      <p className="text-muted">
        Content is managed as data. Bulk changes go through the importer (<code>npm run content:import</code>,
        see docs/curriculum.md); in-app editing forms are on the roadmap (Phase 15).
      </p>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {counts.map((c) => (
          <li key={c.table}>
            <Card className="p-4">
              <p className="text-muted text-sm font-semibold">{c.label}</p>
              <p className="text-3xl font-extrabold">{c.published}</p>
              <p className="text-muted text-xs">{c.total - c.published} draft or archived</p>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
