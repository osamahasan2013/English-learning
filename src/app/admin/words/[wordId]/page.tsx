import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { ImageUploadForm } from "@/components/vocabulary/image-upload-form";
import { WordPicture } from "@/components/vocabulary/word-picture";
import { requireAdmin } from "@/lib/auth/session";
import { WORD_AREA_LABELS } from "@/lib/learning/vocabulary";
import { loadWordDetail } from "@/lib/server/vocabulary";

export const metadata: Metadata = { title: "Word" };

export default async function AdminWordPage(props: PageProps<"/admin/words/[wordId]">) {
  await requireAdmin();
  const { wordId } = await props.params;
  const word = await loadWordDetail(wordId);
  if (!word) notFound();
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1">
      <dt className="text-muted font-semibold">{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
  return (
    <>
      <Link href="/admin/words" className="text-primary font-semibold">
        ← Words
      </Link>
      <div className="flex items-center gap-4">
        <WordPicture word={word.word} emoji={word.emoji} image={word.image} size="md" />
        <h1 className="text-3xl font-extrabold">{word.word}</h1>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Word</CardTitle>
          <dl>
            {row("Meaning (child)", word.meaning)}
            {row("Definition", word.definition)}
            {row("Part of speech", word.partOfSpeech)}
            {row(
              "Levels",
              word.levels.map((l) => `${l.short_name}${l.primary ? " (introduced)" : ""}`).join(", "),
            )}
            {row("Category", [word.topCategory?.name, word.category?.name].filter(Boolean).join(" › "))}
            {row("Difficulty", word.difficulty)}
            {row("Syllables", word.syllables)}
            {row(
              "Sounds",
              word.segments
                .map((s) => (s.silent ? `(${s.grapheme})` : `${s.grapheme}=${s.label}`))
                .join(" · "),
            )}
            {row("Shape", `${word.shape ?? "—"}${word.decodable ? " · decodable" : ""}`)}
            {row("Phonics patterns", word.patterns.map((p) => p.pattern).join(", "))}
            {row("Spelling note", word.irregular)}
            {row("Plural", word.plural)}
            {row(
              "Forms",
              Object.entries(word.inflections)
                .map(([k, v]) => `${k}: ${v}`)
                .join(", "),
            )}
          </dl>
        </Card>
        <Card className="space-y-3">
          <CardTitle>Examples and relations</CardTitle>
          <ul className="list-disc pl-5">
            {word.examples.map((e) => (
              <li key={e.text}>{e.text}</li>
            ))}
          </ul>
          {word.examples.length === 0 ? <p className="text-muted">No example sentence yet.</p> : null}
          <dl>
            {row("Same meaning", word.synonyms.map((w) => w.word).join(", "))}
            {row("Opposite", word.antonyms.map((w) => w.word).join(", "))}
            {row("Related", word.related.map((w) => `${w.word} (${w.type.replace("_", " ")})`).join(", "))}
            {row(
              "Families",
              word.families.map((f) => `-${f.rime}: ${f.words.map((w) => w.word).join(", ")}`).join("; "),
            )}
            {row(
              "Practice",
              word.practiceAreas.map((a) => WORD_AREA_LABELS[a].label).join(", ") || "no questions yet",
            )}
            {row("Audio", word.audioUrl ? "recorded" : "speech synthesis")}
          </dl>
        </Card>
      </div>
      <Card className="space-y-3">
        <CardTitle>Picture</CardTitle>
        {word.image ? (
          <p>Current picture: {word.image.alt}</p>
        ) : (
          <p className="text-muted">Shown as {word.emoji || "a book"} until a picture is uploaded.</p>
        )}
        <ImageUploadForm wordId={word.id} word={word.word} />
      </Card>
    </>
  );
}
