import type { Metadata } from "next";
import { PatternSearchView, readPatternSearch } from "@/components/phonics/pattern-search";

export const metadata: Metadata = { title: "Phonics patterns" };

export default async function ParentPhonicsPage(props: PageProps<"/parent/phonics">) {
  const search = readPatternSearch(await props.searchParams);
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-extrabold">Phonics patterns</h1>
      <p className="text-muted max-w-2xl">
        The letter patterns your child learns, the sounds they make, and example words. Search for a pattern
        like <strong>sh</strong> or filter by type (digraphs, vowel teams, magic e…).
      </p>
      <PatternSearchView basePath="/parent/phonics" search={search} />
    </div>
  );
}
