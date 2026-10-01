import Link from "next/link";

// The top of every child Words screen: a big back button and the screen's title.
export function WordsHeader({
  back,
  backLabel,
  emoji,
  title,
}: {
  back: string;
  backLabel: string;
  emoji: string;
  title: string;
}) {
  return (
    <section className="flex flex-wrap items-center gap-4">
      <Link
        href={back}
        aria-label={backLabel}
        className="bg-surface flex size-12 items-center justify-center rounded-full text-2xl font-bold shadow-sm"
      >
        <span aria-hidden>{back === "/child/home" ? "🏠" : "⬅"}</span>
      </Link>
      <h1 className="text-4xl font-extrabold">
        <span aria-hidden>{emoji} </span>
        {title}
      </h1>
    </section>
  );
}
