import type { Metadata } from "next";
import Link from "next/link";
import { ListenTo } from "@/components/child/listen-to";
import { requireActiveChild } from "@/lib/auth/session";
import { nextPhonicsSkill, PHONICS_SECTIONS, type PhonicsSectionKey } from "@/lib/learning/phonics-progress";
import { loadChildPhonics, type ChildPhonics } from "@/lib/server/phonics";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Phonics" };

// The child's Phonics screen: six big cards, then the chosen part. Children see stars and
// "practise sh" — never percentages (parents get those on their dashboard).

const CARDS: { key: PhonicsSectionKey; title: string; emoji: string; say: string }[] = [
  ...PHONICS_SECTIONS.map((s) => ({
    key: s.key,
    title: s.title,
    emoji: s.emoji,
    say:
      s.key === "letters"
        ? "Letters. Look at a letter, hear its name and its sound."
        : s.key === "sounds"
          ? "Sounds. Listen for the sound at the start, the middle and the end."
          : s.key === "blend"
            ? "Blend. Put sounds together to read a word."
            : "Read words. Find letter teams like s h and e e, then read.",
  })),
  { key: "practice", title: "Practice", emoji: "🎯", say: "Practice. Play again to get better." },
  { key: "mastery", title: "Mastery", emoji: "🏆", say: "Mastery. See your stars." },
];

function Stars({ count, label }: { count: number; label?: string }) {
  return (
    <span className="text-xl whitespace-nowrap" aria-label={label ?? `${count} of 3 stars`} role="img">
      {"⭐".repeat(count)}
      <span className="opacity-25">{"⭐".repeat(3 - count)}</span>
    </span>
  );
}

export default async function ChildPhonicsPage(props: PageProps<"/child/phonics">) {
  const child = await requireActiveChild();
  const { show } = await props.searchParams;
  const section = CARDS.find((c) => c.key === show)?.key ?? null;
  const phonics = await loadChildPhonics(child.id);
  const next = nextPhonicsSkill(phonics.stages);
  const active = CARDS.find((c) => c.key === section);

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-center gap-4">
        <Link
          href={section ? "/child/phonics" : "/child/home"}
          aria-label={section ? "Back to phonics" : "Go home"}
          className="bg-surface flex size-12 items-center justify-center rounded-full text-2xl font-bold shadow-sm"
        >
          <span aria-hidden>{section ? "⬅" : "🏠"}</span>
        </Link>
        <h1 className="text-4xl font-extrabold">
          <span aria-hidden>{active?.emoji ?? "🔤"} </span>
          {active?.title ?? "Phonics"}
        </h1>
      </section>

      {!section ? (
        <>
          {next ? (
            <Link
              href={`/child/learn/${next.lessonId}`}
              className="bg-success flex items-center gap-5 rounded-[2rem] p-6 text-white shadow-lg transition hover:brightness-110"
            >
              <span className="flex size-20 shrink-0 items-center justify-center rounded-full bg-white/20 text-4xl font-extrabold">
                {next.patternLabel ?? <span aria-hidden>{next.emoji || "▶"}</span>}
              </span>
              <span>
                <span className="block text-lg font-semibold opacity-90">Next</span>
                <span className="block text-3xl font-extrabold">{next.title}</span>
              </span>
            </Link>
          ) : null}
          <nav aria-label="Phonics">
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {CARDS.map((card) => (
                <li key={card.key}>
                  <Link
                    href={`/child/phonics?show=${card.key}`}
                    className="bg-surface hover:bg-accent-soft flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-[2rem] p-4 text-center shadow-sm transition hover:scale-[1.02]"
                  >
                    <span className="text-6xl" aria-hidden>
                      {card.emoji}
                    </span>
                    <span className="text-2xl font-extrabold">{card.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </>
      ) : (
        <ListenTo text={active!.say} />
      )}

      {section === "letters" ? <LettersSection phonics={phonics} /> : null}
      {section === "sounds" || section === "blend" || section === "read" ? (
        <StagesSection phonics={phonics} stages={PHONICS_SECTIONS.find((s) => s.key === section)!.stages} />
      ) : null}
      {section === "practice" ? <PracticeSection phonics={phonics} /> : null}
      {section === "mastery" ? <MasterySection phonics={phonics} /> : null}
    </div>
  );
}

function LettersSection({ phonics }: { phonics: ChildPhonics }) {
  const letters = phonics.stages.find((s) => s.code === "LETTER_SOUNDS")?.skills ?? [];
  const extra = phonics.stages.find((s) => s.code === "LETTERS")?.skills ?? [];
  return (
    <div className="space-y-6">
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7" aria-label="Letters A to Z">
        {letters.map((s) => (
          <li key={s.skillId}>
            <SkillCard skill={s} big />
          </li>
        ))}
      </ul>
      {extra.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {extra.map((s) => (
            <li key={s.skillId}>
              <SkillCard skill={s} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StagesSection({ phonics, stages }: { phonics: ChildPhonics; stages: readonly string[] }) {
  const shown = phonics.stages.filter((s) => stages.includes(s.code));
  if (shown.length === 0) return <p className="text-muted text-2xl">Coming soon!</p>;
  return (
    <div className="space-y-6">
      {shown.map((stage) => (
        <section key={stage.code} aria-labelledby={`stage-${stage.code}`} className="space-y-3">
          <h2
            id={`stage-${stage.code}`}
            className="flex flex-wrap items-center gap-3 text-2xl font-extrabold"
          >
            <span>
              <span aria-hidden>{stage.emoji} </span>
              {stage.childName}
            </span>
            <Stars count={stage.stars} />
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {stage.skills.map((s) => (
              <li key={s.skillId}>
                <SkillCard skill={s} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SkillCard({
  skill,
  big = false,
}: {
  skill: ChildPhonics["stages"][number]["skills"][number];
  big?: boolean;
}) {
  const body = (
    <>
      <span
        className={cn("font-extrabold", big ? "text-4xl" : "text-3xl", !skill.patternLabel && "text-4xl")}
        aria-hidden={!skill.patternLabel}
      >
        {skill.patternLabel ?? skill.emoji ?? "📘"}
      </span>
      {!big && skill.title.toLowerCase() !== skill.patternLabel?.toLowerCase() ? (
        <span className="text-lg leading-tight font-bold">{skill.title}</span>
      ) : null}
      <Stars count={skill.stars} label={`${skill.title}: ${skill.stars} of 3 stars`} />
    </>
  );
  const className = cn(
    "flex flex-col items-center justify-center gap-1 rounded-3xl p-3 text-center shadow-sm transition",
    big ? "aspect-square" : "min-h-32",
    skill.stars === 3 ? "bg-success-soft" : "bg-surface hover:bg-accent-soft hover:scale-[1.02]",
  );
  return skill.lessonId ? (
    <Link href={`/child/learn/${skill.lessonId}`} className={className}>
      {big ? <span className="sr-only">{skill.title}</span> : null}
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function PracticeSection({ phonics }: { phonics: ChildPhonics }) {
  return (
    <div className="space-y-6">
      {phonics.practice.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {phonics.practice.map((s) => (
            <li key={s.skillId}>
              <Link
                href={`/child/learn/${s.lessonId}`}
                className="bg-surface hover:bg-accent-soft flex min-h-24 items-center gap-4 rounded-3xl p-4 shadow-sm transition"
              >
                <span className="bg-accent-soft flex size-16 shrink-0 items-center justify-center rounded-full text-2xl font-extrabold">
                  {s.patternLabel ?? <span aria-hidden>🔁</span>}
                </span>
                <span className="text-2xl font-bold">Practise {s.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="bg-surface rounded-3xl p-5 text-2xl font-bold shadow-sm">
          <span aria-hidden>🌟 </span>Nothing to practise right now. Great job!
        </p>
      )}
      {phonics.check ? (
        <Link
          href={`/child/check/${phonics.check.code}`}
          className="bg-primary flex items-center gap-4 rounded-[2rem] p-6 text-white shadow-lg transition hover:brightness-110"
        >
          <span className="text-5xl" aria-hidden>
            {phonics.check.emoji}
          </span>
          <span>
            <span className="block text-lg font-semibold opacity-90">Show what you know</span>
            <span className="block text-3xl font-extrabold">{phonics.check.title}</span>
          </span>
        </Link>
      ) : null}
    </div>
  );
}

function MasterySection({ phonics }: { phonics: ChildPhonics }) {
  return (
    <ul className="bg-surface divide-border divide-y rounded-[2rem] px-5 shadow-sm">
      {phonics.stages.map((stage) => (
        <li key={stage.code} className="flex min-h-16 items-center justify-between gap-4 py-3">
          <span className="text-2xl font-bold">
            <span aria-hidden>{stage.emoji} </span>
            {stage.childName}
          </span>
          <Stars count={stage.stars} label={`${stage.childName}: ${stage.stars} of 3 stars`} />
        </li>
      ))}
    </ul>
  );
}
