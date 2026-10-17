import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChildSwitcher } from "@/components/parent/child-switcher";
import { DomainOverviewCard } from "@/components/parent/parent-view";
import { loadDomainOverview, loadFamily } from "@/lib/server/parent-view";
import { VocabularyReportView } from "@/components/parent/vocabulary-report";
import { WordSearchView } from "@/components/vocabulary/word-search";
import { loadVocabularyReport } from "@/lib/server/vocabulary";
import { parseWordSearch } from "@/lib/validation/vocabulary";

export const metadata: Metadata = { title: "Words" };

// Vocabulary progress for one of the parent's children (RLS: never another family's), and
// the word bank search: which words practise sh, which are CVC, which suit Grade 1…
export default async function ParentWordsPage(props: PageProps<"/parent/words">) {
  const params = await props.searchParams;
  const { children, child } = await loadFamily(params.child);
  if (!child) redirect("/onboarding");
  const search = parseWordSearch(params);
  const [report, overview] = await Promise.all([
    loadVocabularyReport(child.id),
    loadDomainOverview(child, "VOCABULARY"),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Words</h1>
      <ChildSwitcher kids={children} currentId={child.id} basePath="/parent/words" />
      <DomainOverviewCard overview={overview} childId={child.id} childName={child.name} />
      <section aria-labelledby="progress" className="space-y-3">
        <h2 id="progress" className="text-2xl font-bold">
          {child.name}&apos;s vocabulary
        </h2>
        <VocabularyReportView report={report} />
      </section>
      <section aria-labelledby="bank" className="space-y-3">
        <h2 id="bank" className="text-2xl font-bold">
          Word bank
        </h2>
        <p className="text-muted max-w-2xl">
          Find words by how they start, category, level, phonics pattern (for example <strong>sh</strong>) or
          shape (CVC words like <strong>cat</strong>).
        </p>
        <WordSearchView basePath="/parent/words" search={search} hidden={{ child: child.id }} />
      </section>
    </div>
  );
}
