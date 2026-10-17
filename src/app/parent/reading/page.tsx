import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChildSwitcher } from "@/components/parent/child-switcher";
import { DomainOverviewCard } from "@/components/parent/parent-view";
import { loadDomainOverview, loadFamily } from "@/lib/server/parent-view";
import { ReadingReportView } from "@/components/parent/reading-report";
import { loadReadingReport } from "@/lib/server/reading";

export const metadata: Metadata = { title: "Reading" };

// Reading progress for one of the parent's children (RLS: never another family's child).
export default async function ParentReadingPage(props: PageProps<"/parent/reading">) {
  const params = await props.searchParams;
  const { children, child } = await loadFamily(params.child);
  if (!child) redirect("/onboarding");
  const [report, overview] = await Promise.all([
    loadReadingReport(child.id, child.current_level_id),
    loadDomainOverview(child, "READING"),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Reading</h1>
      <ChildSwitcher kids={children} currentId={child.id} basePath="/parent/reading" />
      <DomainOverviewCard overview={overview} childId={child.id} childName={child.name} />
      <section aria-labelledby="progress" className="space-y-3">
        <h2 id="progress" className="text-2xl font-bold">
          {child.name}&apos;s reading
        </h2>
        <ReadingReportView report={report} />
      </section>
    </div>
  );
}
