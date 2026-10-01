import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { VocabularyReportView } from "@/components/parent/vocabulary-report";
import { WordSearchView } from "@/components/vocabulary/word-search";
import { avatarEmoji } from "@/lib/avatars";
import { listChildren } from "@/lib/server/family-data";
import { loadVocabularyReport } from "@/lib/server/vocabulary";
import { cn } from "@/lib/utils";
import { parseWordSearch } from "@/lib/validation/vocabulary";

export const metadata: Metadata = { title: "Words" };

// Vocabulary progress for one of the parent's children (RLS: never another family's), and
// the word bank search: which words practise sh, which are CVC, which suit Grade 1…
export default async function ParentWordsPage(props: PageProps<"/parent/words">) {
  const params = await props.searchParams;
  const children = await listChildren();
  if (children.length === 0) redirect("/onboarding");
  const childParam = typeof params.child === "string" ? params.child : undefined;
  const child = children.find((c) => c.id === childParam) ?? children[0];
  const search = parseWordSearch(params);
  const report = await loadVocabularyReport(child.id);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Words</h1>
      {children.length > 1 ? (
        <nav aria-label="Choose a child" className="flex flex-wrap gap-2">
          {children.map((c) => (
            <Link
              key={c.id}
              href={`/parent/words?child=${c.id}`}
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
