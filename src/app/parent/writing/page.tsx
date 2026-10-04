import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WritingReportView } from "@/components/parent/writing-report";
import { avatarEmoji } from "@/lib/avatars";
import { listChildren } from "@/lib/server/family-data";
import { loadWritingReport } from "@/lib/server/writing";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Writing" };

// Writing progress for one of the parent's children (RLS: never another family's child).
export default async function ParentWritingPage(props: PageProps<"/parent/writing">) {
  const params = await props.searchParams;
  const children = await listChildren();
  if (children.length === 0) redirect("/onboarding");
  const childParam = typeof params.child === "string" ? params.child : undefined;
  const child = children.find((c) => c.id === childParam) ?? children[0];
  const report = await loadWritingReport(child.id, child.current_level_id);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Writing</h1>
      {children.length > 1 ? (
        <nav aria-label="Choose a child" className="flex flex-wrap gap-2">
          {children.map((c) => (
            <Link
              key={c.id}
              href={`/parent/writing?child=${c.id}`}
              aria-current={c.id === child.id ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-full border-2 px-4 font-semibold",
                c.id === child.id ? "border-primary bg-accent-soft" : "border-border bg-surface",
              )}
            >
              <span aria-hidden>{avatarEmoji(c.avatar)}</span> {c.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <section aria-labelledby="progress" className="space-y-3">
        <h2 id="progress" className="text-2xl font-bold">
          {child.name}&apos;s writing
        </h2>
        <WritingReportView report={report} />
      </section>
    </div>
  );
}
