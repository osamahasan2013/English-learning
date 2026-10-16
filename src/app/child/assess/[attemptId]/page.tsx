import type { Metadata } from "next";
import Link from "next/link";
import { LessonPlayer } from "@/features/lesson-player/lesson-player";
import { requireActiveChild } from "@/lib/auth/session";
import { loadSittingPayload } from "@/lib/server/lesson-loader";

export const metadata: Metadata = { title: "Check" };

// An assessment sitting in the ordinary lesson player (Phase 9). The sitting was started by
// the server (it chose the questions); this page only plays it. A sitting of another child,
// or one that is finished, cancelled or expired, is not played.
export default async function AssessPage(props: PageProps<"/child/assess/[attemptId]">) {
  const child = await requireActiveChild();
  const { attemptId } = await props.params;
  const payload = await loadSittingPayload(child.id, attemptId);
  if (!payload || "closed" in payload) {
    return (
      <div className="flex flex-col items-center gap-6 py-16 text-center">
        <span className="text-8xl" aria-hidden>
          {payload ? "✅" : "🔍"}
        </span>
        <p className="text-3xl font-extrabold">
          {payload ? "This check is finished." : "This check isn't here."}
        </p>
        <Link href="/child/home" className="bg-success rounded-3xl px-8 py-5 text-2xl font-bold text-white">
          <span aria-hidden>🏠</span> Home
        </Link>
      </div>
    );
  }
  return <LessonPlayer payload={payload} childId={child.id} learningEpoch={child.learning_epoch} />;
}
