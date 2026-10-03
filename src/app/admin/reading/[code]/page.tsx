import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { PassagePreview } from "@/features/reading/passage-preview";
import { DEFAULT_RULES } from "@/lib/learning/rules";
import { loadAdminStory } from "@/lib/server/reading";
import { setStoryStatus } from "../actions";

export const metadata: Metadata = { title: "Reading text" };

// One reading text: a preview exactly as children see it, the importer's analysis (text
// statistics, decodability per word, words outside the word bank), its comprehension
// questions with the reading skill each one counts towards, and publish / unpublish.
export default async function AdminStoryPage(props: PageProps<"/admin/reading/[code]">) {
  const { code } = await props.params;
  const story = await loadAdminStory(code);
  if (!story) notFound();
  const levelRules = DEFAULT_RULES.reading.levels[story.level?.code ?? ""] ?? null;
  const stats = story.stats as Record<string, number>;

  return (
    <div className="space-y-6">
      <Link href="/admin/reading" className="text-primary font-semibold">
        ← All texts
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-extrabold">{story.passage.title}</h1>
        <form action={setStoryStatus} className="flex items-center gap-3">
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="status" value={story.status === "published" ? "draft" : "published"} />
          <span className="font-semibold">{story.status === "published" ? "Published" : "Draft"}</span>
          <Button type="submit" variant="secondary">
            {story.status === "published" ? "Unpublish" : "Publish"}
          </Button>
        </form>
      </div>
      <p className="text-muted">
        {story.level?.name} · {story.passage.contentTypeName} · difficulty {story.difficulty}
        {story.readingLevel ? ` · band ${story.readingLevel}` : ""}
        {story.genre ? ` · ${story.genre}` : ""}
        {story.topic ? ` · ${story.topic}` : ""} · {story.lessonId ? "read by a lesson" : "no lesson yet"}
      </p>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <PassagePreview passage={story.passage} highlight={levelRules?.highlight ?? "sentence"} />
        <div className="space-y-6">
          <Card className="space-y-2">
            <CardTitle>Analysis</CardTitle>
            <ul className="space-y-1 text-sm">
              <li>
                {stats.words ?? 0} words · {stats.uniqueWords ?? 0} different · {stats.sentences ?? 0}{" "}
                sentences · {stats.paragraphs ?? 0} paragraphs
              </li>
              <li>
                Average sentence {stats.avgSentenceWords ?? 0} words (longest {stats.longestSentence ?? 0}
                {levelRules ? `, level max ${levelRules.maxSentenceWords}` : ""})
              </li>
              <li>
                Decodable or sight words:{" "}
                {story.decodablePct === null ? "—" : `${Math.round(story.decodablePct)}%`}
                {levelRules ? ` (level expects ${levelRules.minDecodablePct}%+)` : ""}
              </li>
              <li>Target patterns: {story.patterns.map((p) => p!.pattern).join(", ") || "—"}</li>
              <li>Reading skills: {story.skills.join(", ") || "—"}</li>
              <li>
                Not in the word bank:{" "}
                {story.unknownWords.length ? <strong>{story.unknownWords.join(", ")}</strong> : "none"}
              </li>
            </ul>
          </Card>
          <Card className="space-y-2">
            <CardTitle>Words</CardTitle>
            <ul className="flex flex-wrap gap-1.5 text-sm">
              {story.words
                .sort((a, b) => a.word.localeCompare(b.word))
                .map((w) => (
                  <li
                    key={w.word}
                    className="bg-surface-muted rounded-full px-2.5 py-0.5"
                    title={[
                      w.decodable && "decodable",
                      w.sight && "sight",
                      w.irregular && "irregular",
                      w.target && "target pattern",
                      w.focus && "focus",
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  >
                    {w.focus ? "★ " : ""}
                    {w.word}
                    <span className="text-muted">
                      {" "}
                      {w.decodable ? "D" : w.sight ? "S" : "–"}
                      {w.target ? "·T" : ""}
                    </span>
                  </li>
                ))}
            </ul>
            <p className="text-muted text-xs">D decodable · S sight word · T target pattern · ★ focus word</p>
          </Card>
        </div>
      </div>

      <Card className="space-y-3">
        <CardTitle>Questions</CardTitle>
        {story.questions.length === 0 ? (
          <p className="text-muted">No questions.</p>
        ) : (
          <ul className="divide-border divide-y text-sm">
            {story.questions.map((q) => (
              <li key={q.id} className="flex flex-wrap gap-3 py-2">
                <code className="text-muted">{q.type}</code>
                <span className="flex-1 font-semibold">{q.prompt}</span>
                <span className="text-muted">{q.readingSkill ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
