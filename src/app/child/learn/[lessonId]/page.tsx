import type { Metadata } from "next";
import Link from "next/link";
import { LessonPlayer } from "@/features/lesson-player/lesson-player";
import { requireActiveChild } from "@/lib/auth/session";
import { loadLessonPayload } from "@/lib/server/lesson-loader";

export const metadata: Metadata = { title: "Lesson" };

export default async function LessonPage(props: PageProps<"/child/learn/[lessonId]">) {
  const child = await requireActiveChild();
  const { lessonId } = await props.params;
  const payload = await loadLessonPayload(lessonId);

  if (!payload) {
    return (
      <div className="flex flex-col items-center gap-6 py-16 text-center">
        <span className="text-8xl" aria-hidden>
          🔍
        </span>
        <p className="text-3xl font-extrabold">This lesson isn&apos;t ready yet.</p>
        <Link href="/child/home" className="bg-success rounded-3xl px-8 py-5 text-2xl font-bold text-white">
          <span aria-hidden>🏠</span> Home
        </Link>
      </div>
    );
  }
  return <LessonPlayer payload={payload} childId={child.id} />;
}
