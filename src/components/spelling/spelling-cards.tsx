import Link from "next/link";

// The big cards at the top of the child's Spelling screen.
export function SpellingCards({
  cards,
}: {
  cards: { href: string; emoji: string; title: string; note: string }[];
}) {
  return (
    <nav aria-label="Spelling">
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <li key={card.title}>
            <Link
              href={card.href}
              className="bg-surface hover:bg-accent-soft flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-[2rem] p-4 text-center shadow-sm transition hover:scale-[1.02]"
            >
              <span className="text-5xl" aria-hidden>
                {card.emoji}
              </span>
              <span className="text-2xl font-extrabold">{card.title}</span>
              {card.note ? <span className="text-muted text-lg font-bold">{card.note}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
