import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { loadAdminStories } from "@/lib/server/reading";

export const metadata: Metadata = { title: "Reading texts" };

// Every reading text with the importer's analysis: level, type, words, decodability, words
// outside the word bank, open review flags, and whether a lesson reads it. Texts are
// authored in content/stories.json and loaded with `npm run content:import`.
export default async function AdminReadingPage() {
  const stories = await loadAdminStories();
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Reading texts</h1>
      <p className="text-muted max-w-3xl">
        Texts live in <code>content/stories.json</code>; questions become lessons through the{" "}
        <code>reading</code> lesson blueprint. Decodable % counts words that are decodable with the patterns
        taught up to the text&apos;s level, or known sight words.
      </p>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="text-muted border-border border-b">
            <tr>
              <th className="p-3 font-semibold">Text</th>
              <th className="p-3 font-semibold">Level</th>
              <th className="p-3 font-semibold">Type</th>
              <th className="p-3 font-semibold">Words</th>
              <th className="p-3 font-semibold">Decodable</th>
              <th className="p-3 font-semibold">Lesson</th>
              <th className="p-3 font-semibold">Flags</th>
              <th className="p-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {stories.map((s) => (
              <tr key={s.code}>
                <td className="p-3">
                  <Link href={`/admin/reading/${s.code}`} className="text-primary font-semibold">
                    <span aria-hidden>{s.emoji} </span>
                    {s.title}
                  </Link>
                </td>
                <td className="p-3">
                  {s.levelName}
                  {s.readingLevel ? <span className="text-muted"> · band {s.readingLevel}</span> : null}
                </td>
                <td className="p-3">{s.contentTypeName}</td>
                <td className="p-3">{s.wordCount}</td>
                <td className="p-3">{s.decodablePct === null ? "—" : `${Math.round(s.decodablePct)}%`}</td>
                <td className="p-3">{s.lessonId ? "✓" : "—"}</td>
                <td className="p-3">
                  {s.flags.length + (s.unknownWords.length ? 1 : 0) > 0 ? (
                    <span>⚠️ {s.flags.length}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="p-3">
                  {s.status === "published" ? "Published" : s.status === "draft" ? "Draft" : "Archived"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
