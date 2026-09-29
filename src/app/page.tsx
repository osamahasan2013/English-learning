import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClasses } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth/session";
import { APP_SHORT_NAME } from "@/lib/app-info";

export default async function HomePage() {
  if (await getSessionUser()) redirect("/parent/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 px-4 py-12">
      <div className="text-7xl" aria-hidden>
        🌱📚🦉
      </div>
      <div className="space-y-4">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">{APP_SHORT_NAME}</h1>
        <p className="text-muted text-xl">
          English reading for children from KG1 to Grade 2: letter sounds, phonics, blending, sight words,
          spelling and sentences, one small step at a time.
        </p>
        <ul className="space-y-2 text-lg">
          <li>🔊 Every word and sound can be heard, slowly too.</li>
          <li>👨‍👩‍👧 One family account, a separate profile and progress for each child.</li>
          <li>📈 Clear progress for parents: what is going well and what to practise next.</li>
          <li>📶 Keeps working offline and syncs when you are back online.</li>
        </ul>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/register" className={buttonClasses("primary", "lg")}>
          Create a family account
        </Link>
        <Link href="/login" className={buttonClasses("secondary", "lg")}>
          Log in
        </Link>
      </div>
    </main>
  );
}
