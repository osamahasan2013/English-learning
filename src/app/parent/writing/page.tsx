import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChildSwitcher } from "@/components/parent/child-switcher";
import { DomainOverviewCard } from "@/components/parent/parent-view";
import { loadDomainOverview, loadFamily } from "@/lib/server/parent-view";
import { WritingReportView } from "@/components/parent/writing-report";
import { loadWritingReport } from "@/lib/server/writing";

export const metadata: Metadata = { title: "Writing" };

// Writing progress for one of the parent's children (RLS: never another family's child).
export default async function ParentWritingPage(props: PageProps<"/parent/writing">) {
  const params = await props.searchParams;
  const { children, child } = await loadFamily(params.child);
  if (!child) redirect("/onboarding");
  const [report, overview] = await Promise.all([
    loadWritingReport(child.id, child.current_level_id),
    loadDomainOverview(child, "WRITING"),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Writing</h1>
      <ChildSwitcher kids={children} currentId={child.id} basePath="/parent/writing" />
      <DomainOverviewCard overview={overview} childId={child.id} childName={child.name} />
      <section aria-labelledby="progress" className="space-y-3">
        <h2 id="progress" className="text-2xl font-bold">
          {child.name}&apos;s writing
        </h2>
        <WritingReportView report={report} />
      </section>
    </div>
  );
}
