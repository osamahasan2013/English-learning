import type { Metadata } from "next";
import { WordSearchView } from "@/components/vocabulary/word-search";
import { requireAdmin } from "@/lib/auth/session";
import { parseWordSearch } from "@/lib/validation/vocabulary";

export const metadata: Metadata = { title: "Words" };

// Server-side search and pagination: the word bank is meant to grow to thousands of
// entries, so it is never loaded into the browser in full. Admins see drafts too (RLS).
export default async function AdminWordsPage(props: PageProps<"/admin/words">) {
  // Checked here too, not only in the layout (layouts are not re-run on every navigation).
  await requireAdmin();
  const search = parseWordSearch(await props.searchParams);
  return (
    <>
      <h1 className="text-3xl font-extrabold">Words</h1>
      <p className="text-muted max-w-2xl">
        Add or change words with <code>npm run content:import -- --words file.csv</code> (see
        docs/curriculum.md). Open a word to see its sounds, examples and relations, and to upload its picture.
      </p>
      <WordSearchView basePath="/admin/words" search={search} admin />
    </>
  );
}
