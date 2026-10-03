import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SpellingReportView } from "@/components/parent/spelling-report";
import { avatarEmoji } from "@/lib/avatars";
import { listChildren } from "@/lib/server/family-data";
import { loadSpellingReport } from "@/lib/server/spelling";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Spelling" };

// Spelling progress for one of the parent's children (RLS: never another family's child),
// from the stored answers: mastery, mistake kinds, phonics patterns, types, families and the
// latest answers as written.
export default async function ParentSpellingPage(props: PageProps<"/parent/spelling">) {
  const params = await props.searchParams;
  const children = await listChildren();
  if (children.length === 0) redirect("/onboarding");
  const childParam = typeof params.child === "string" ? params.child : undefined;
  const child = children.find((c) => c.id === childParam) ?? children[0];
  const page = Math.max(1, Number(typeof params.page === "string" ? params.page : 1) || 1);
  const report = await loadSpellingReport(child.id, page);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Spelling</h1>
      {children.length > 1 ? (
        <nav aria-label="Choose a child" className="flex flex-wrap gap-2">
          {children.map((c) => (
            <Link
              key={c.id}
              href={`/parent/spelling?child=${c.id}`}
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
          {child.name}&apos;s spelling
        </h2>
        <SpellingReportView report={report} basePath={`/parent/spelling?child=${child.id}`} />
      </section>
    </div>
  );
}
