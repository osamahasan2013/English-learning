import Link from "next/link";
import { Stars, WordPicture } from "@/components/vocabulary/word-picture";
import type { MasteryStatus } from "@/lib/learning/mastery";
import { wordStars } from "@/lib/learning/vocabulary";

// A word as a big tappable card: picture, word and (when started) stars.
export function WordTile({
  id,
  word,
  emoji,
  image = null,
  status,
  badge,
}: {
  id: string;
  word: string;
  emoji: string;
  image?: { url: string; alt: string } | null;
  status?: MasteryStatus;
  badge?: string;
}) {
  const stars = status ? wordStars(status) : 0;
  return (
    <Link
      href={`/child/words/${id}`}
      className="bg-surface hover:bg-accent-soft relative flex min-h-36 flex-col items-center justify-center gap-1 rounded-[2rem] p-3 text-center shadow-sm transition hover:scale-[1.02]"
    >
      {badge ? (
        <span className="bg-accent absolute top-2 right-2 rounded-full px-2 py-0.5 text-sm font-bold text-white">
          {badge}
        </span>
      ) : null}
      <WordPicture word={word} emoji={emoji} image={image} size="sm" decorative />
      <span className="text-2xl font-extrabold">{word}</span>
      {status && status !== "NOT_STARTED" ? <Stars count={stars} /> : null}
    </Link>
  );
}
