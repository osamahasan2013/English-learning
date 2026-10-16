import type { Metadata } from "next";
import Link from "next/link";
import { startCheck } from "@/app/child/assessment-actions";
import { requireActiveChild } from "@/lib/auth/session";
import { parseBlueprint } from "@/lib/learning/assessment-blueprint";
import { loadOpenSittings } from "@/lib/server/assessments";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Check" };

// A check's start screen (Phase 9). Shows the check and a big Start button; Start is a
// server action that starts or resumes the sitting (the server picks the questions) and
// opens it. An open sitting of this check is offered as "Keep going".
export default async function CheckPage(props: PageProps<"/child/check/[code]">) {
  const child = await requireActiveChild();
  const { code } = await props.params;
  const search = await props.searchParams;
  const skill = typeof search.skill === "string" && /^[0-9a-f-]{36}$/i.test(search.skill) ? search.skill : "";
  const supabase = await createClient();
  const { data: assessment } = /^[a-z0-9-]{2,80}$/.test(code)
    ? await supabase
        .from("assessments")
        .select("code, title, config")
        .eq("code", code)
        .eq("status", "published")
        .maybeSingle()
    : { data: null };
  const blueprint = parseBlueprint(assessment?.config);
  const open = (await loadOpenSittings(child.id)).find((s) => s.code === code && !skill);

  if (!assessment || search.unavailable) {
    return (
      <div className="flex flex-col items-center gap-6 py-16 text-center">
        <span className="text-8xl" aria-hidden>
          🔍
        </span>
        <p className="text-3xl font-extrabold">This check isn&apos;t ready yet.</p>
        <Link href="/child/home" className="bg-success rounded-3xl px-8 py-5 text-2xl font-bold text-white">
          <span aria-hidden>🏠</span> Home
        </Link>
      </div>
    );
  }
  const title = blueprint?.childTitle ?? assessment.title;
  return (
    <div className="flex flex-col items-center gap-8 py-12 text-center">
      <span className="text-8xl" aria-hidden>
        {blueprint?.emoji ?? "🎯"}
      </span>
      <h1 className="text-4xl font-extrabold">{title}</h1>
      <p className="text-muted max-w-xl text-2xl font-semibold">Show what you know! Just do your best.</p>
      {open ? (
        <Link
          href={`/child/assess/${open.id}`}
          className="bg-success min-h-20 rounded-[2rem] px-10 py-5 text-3xl font-extrabold text-white shadow-lg"
        >
          <span aria-hidden>▶ </span>Keep going
        </Link>
      ) : (
        <form action={startCheck}>
          <input type="hidden" name="code" value={assessment.code} />
          {skill ? <input type="hidden" name="skill" value={skill} /> : null}
          <button
            type="submit"
            className="bg-success min-h-20 rounded-[2rem] px-10 py-5 text-3xl font-extrabold text-white shadow-lg"
          >
            <span aria-hidden>▶ </span>Start {title}
          </button>
        </form>
      )}
    </div>
  );
}
