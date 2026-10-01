import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListenTo } from "@/components/child/listen-to";
import { WordsHeader } from "@/components/vocabulary/child-header";
import { SaveWordButton } from "@/components/vocabulary/save-word-button";
import { SeenWord } from "@/components/vocabulary/seen-word";
import { SoundStrip } from "@/components/vocabulary/sound-strip";
import { Stars, WordPicture } from "@/components/vocabulary/word-picture";
import { requireActiveChild } from "@/lib/auth/session";
import { wordStars, type WordArea } from "@/lib/learning/vocabulary";
import { loadChildWord, loadWordDetail } from "@/lib/server/vocabulary";

export const metadata: Metadata = { title: "Word" };

// The Word Explorer: see it, hear it, what it means, an example, its sounds, and ways to
// practise. Big targets, few words, audio for everything.
const ACTIVITIES: { key: string; areas: WordArea[]; title: string; emoji: string }[] = [
  { key: "read", areas: ["reading", "recognition"], title: "Read", emoji: "📖" },
  { key: "spell", areas: ["spelling"], title: "Spell", emoji: "✏️" },
  { key: "listen", areas: ["listening"], title: "Listen", emoji: "👂" },
];

export default async function WordExplorerPage(props: PageProps<"/child/words/[wordId]">) {
  const child = await requireActiveChild();
  const { wordId } = await props.params;
  const [word, progress] = await Promise.all([loadWordDetail(wordId), loadChildWord(child.id, wordId)]);
  if (!word) notFound();
  const example = word.examples[0] ?? null;
  const activities = ACTIVITIES.flatMap((a) => {
    const area = a.areas.find((x) => word.practiceAreas.includes(x));
    return area ? [{ ...a, href: `/child/words/${word.id}/practice?area=${area}` }] : [];
  });
  const back = word.category
    ? `/child/words/category/${(word.topCategory ?? word.category).code}`
    : "/child/words";

  return (
    <div className="space-y-6">
      <SeenWord wordId={word.id} />
      <WordsHeader back={back} backLabel="Back" emoji="🔎" title="Word Explorer" />

      <article className="bg-surface space-y-6 rounded-[2rem] p-6 shadow-sm" aria-labelledby="the-word">
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          <WordPicture word={word.word} emoji={word.emoji} image={word.image} size="lg" />
          <div className="space-y-3">
            <h2 id="the-word" className="text-6xl font-extrabold tracking-wide uppercase">
              {word.word}
            </h2>
            <ListenTo text={word.speech} assetUrl={word.audioUrl} />
            <div className="flex flex-wrap items-center gap-3">
              <SaveWordButton wordId={word.id} word={word.word} saved={progress.saved} />
              {progress.status !== "NOT_STARTED" ? <Stars count={wordStars(progress.status)} /> : null}
            </div>
          </div>
        </div>

        {word.meaning ? (
          <section aria-labelledby="meaning" className="space-y-2">
            <h3 id="meaning" className="text-2xl font-extrabold">
              <span aria-hidden>💡 </span>Meaning
            </h3>
            <p className="text-2xl">{word.meaning}</p>
            <ListenTo text={word.meaning} />
          </section>
        ) : null}

        {example ? (
          <section aria-labelledby="example" className="space-y-2">
            <h3 id="example" className="text-2xl font-extrabold">
              <span aria-hidden>💬 </span>Example
            </h3>
            <p className="text-2xl">
              {example.emoji ? <span aria-hidden>{example.emoji} </span> : null}“{example.text}”
            </p>
            <ListenTo text={example.text} />
          </section>
        ) : null}

        {word.segments.length > 0 ? (
          <section aria-labelledby="sounds" className="space-y-2">
            <h3 id="sounds" className="text-2xl font-extrabold">
              <span aria-hidden>🔤 </span>Sounds
            </h3>
            <SoundStrip word={word.word} segments={word.segments} />
            {word.irregular ? <p className="text-muted text-lg">{word.irregular}</p> : null}
          </section>
        ) : null}

        {word.families.length > 0 || word.antonyms.length > 0 || word.synonyms.length > 0 ? (
          <section aria-labelledby="friends" className="space-y-3">
            <h3 id="friends" className="text-2xl font-extrabold">
              <span aria-hidden>🤝 </span>Word friends
            </h3>
            {word.families.map((f) => (
              <WordChips key={f.code} label={`-${f.rime} family`} words={f.words} />
            ))}
            {word.synonyms.length > 0 ? <WordChips label="Means the same" words={word.synonyms} /> : null}
            {word.antonyms.length > 0 ? <WordChips label="Opposite" words={word.antonyms} /> : null}
          </section>
        ) : null}
      </article>

      <section aria-labelledby="practice" className="space-y-3">
        <h2 id="practice" className="text-2xl font-extrabold">
          <span aria-hidden>🎯 </span>Practice
        </h2>
        {word.practiceAreas.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {activities.map((a) => (
              <li key={a.key}>
                <Link
                  href={a.href}
                  className="bg-surface hover:bg-accent-soft flex min-h-28 flex-col items-center justify-center gap-1 rounded-3xl p-4 shadow-sm transition"
                >
                  <span className="text-4xl" aria-hidden>
                    {a.emoji}
                  </span>
                  <span className="text-2xl font-extrabold">{a.title}</span>
                </Link>
              </li>
            ))}
            <li>
              <Link
                href={`/child/words/${word.id}/practice`}
                className="bg-success flex min-h-28 flex-col items-center justify-center gap-1 rounded-3xl p-4 text-white shadow-sm transition hover:brightness-110"
              >
                <span className="text-4xl" aria-hidden>
                  🎯
                </span>
                <span className="text-2xl font-extrabold">Practice</span>
              </Link>
            </li>
          </ul>
        ) : (
          <p className="bg-surface rounded-3xl p-5 text-xl font-bold shadow-sm">
            <span aria-hidden>🌱 </span>Games for this word are coming soon. Listen and save it for now!
          </p>
        )}
      </section>
    </div>
  );
}

function WordChips({
  label,
  words,
}: {
  label: string;
  words: { id: string; word: string; emoji: string }[];
}) {
  if (words.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted text-lg font-bold">{label}:</span>
      {words.map((w) => (
        <Link
          key={w.id}
          href={`/child/words/${w.id}`}
          className="bg-accent-soft rounded-2xl px-4 py-2 text-xl font-bold"
        >
          {w.emoji ? <span aria-hidden>{w.emoji} </span> : null}
          {w.word}
        </Link>
      ))}
    </div>
  );
}
