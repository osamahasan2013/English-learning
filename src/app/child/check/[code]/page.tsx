import type { Metadata } from "next";
import Link from "next/link";
import { LessonPlayer } from "@/features/lesson-player/lesson-player";
import { requireActiveChild } from "@/lib/auth/session";
import { loadAssessmentPayload } from "@/lib/server/lesson-loader";

export const metadata: Metadata = { title: "Sound Check" };

// A skill check (e.g. the Phonics Check) in the ordinary lesson player: one try per
// question; the server scores each area from the stored answers.
export default async function CheckPage(props: PageProps<"/child/check/[code]">) {
  const child = await requireActiveChild();
  const { code } = await props.params;
  const payload = await loadAssessmentPayload(code);

  if (!payload) {
    return (
      <div className="flex flex-col items-center gap-6 py-16 text-center">
        <span className="text-8xl" aria-hidden>
          🔍
        </span>
        <p className="text-3xl font-extrabold">This check isn&apos;t ready yet.</p>
        <Link
          href="/child/phonics"
          className="bg-success rounded-3xl px-8 py-5 text-2xl font-bold text-white"
        >
          <span aria-hidden>🔤</span> Phonics
        </Link>
      </div>
    );
  }
  return <LessonPlayer payload={payload} childId={child.id} learningEpoch={child.learning_epoch} />;
}
