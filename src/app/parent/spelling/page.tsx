import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChildSwitcher } from "@/components/parent/child-switcher";
import { DomainOverviewCard } from "@/components/parent/parent-view";
import { loadDomainOverview, loadFamily } from "@/lib/server/parent-view";
import { SpellingReportView } from "@/components/parent/spelling-report";
import { loadSpellingReport } from "@/lib/server/spelling";

export const metadata: Metadata = { title: "Spelling" };

// Spelling progress for one of the parent's children (RLS: never another family's child),
// from the stored answers: mastery, mistake kinds, phonics patterns, types, families and the
// latest answers as written.
export default async function ParentSpellingPage(props: PageProps<"/parent/spelling">) {
  const params = await props.searchParams;
  const { children, child } = await loadFamily(params.child);
  if (!child) redirect("/onboarding");
  const page = Math.max(1, Number(typeof params.page === "string" ? params.page : 1) || 1);
  const [report, overview] = await Promise.all([
    loadSpellingReport(child.id, page),
    loadDomainOverview(child, "SPELLING"),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Spelling</h1>
      <ChildSwitcher kids={children} currentId={child.id} basePath="/parent/spelling" />
      <DomainOverviewCard overview={overview} childId={child.id} childName={child.name} />
      <section aria-labelledby="progress" className="space-y-3">
        <h2 id="progress" className="text-2xl font-bold">
          {child.name}&apos;s spelling
        </h2>
        <SpellingReportView report={report} basePath={`/parent/spelling?child=${child.id}`} />
      </section>
    </div>
  );
}
