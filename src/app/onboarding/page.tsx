import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { ChildForm } from "@/components/parent/child-form";
import { APP_SHORT_NAME } from "@/lib/app-info";
import { Card } from "@/components/ui/card";
import { createChild } from "@/app/parent/child-actions";
import { getProfile, requireUser } from "@/lib/auth/session";
import { listChildren, listPublishedLevels } from "@/lib/server/family-data";

export const metadata: Metadata = { title: "Welcome" };

export default async function OnboardingPage() {
  await requireUser("/onboarding");
  const [profile, children, levels] = await Promise.all([
    getProfile(),
    listChildren(),
    listPublishedLevels(),
  ]);
  if (children.length > 0) redirect("/parent/dashboard");

  return (
    <>
      <header className="mx-auto flex max-w-2xl items-center justify-between px-4 pt-4">
        <span className="flex items-center gap-2 text-xl font-extrabold">
          <span aria-hidden>🌱</span> {APP_SHORT_NAME}
        </span>
        <SignOutButton />
      </header>
      <main id="main" className="mx-auto max-w-2xl space-y-6 px-4 py-10">
        <div className="space-y-2">
          <p className="text-5xl" aria-hidden>
            👋
          </p>
          <h1 className="text-3xl font-extrabold">
            Welcome{profile?.display_name ? `, ${profile.display_name}` : ""}!
          </h1>
          <p className="text-muted text-lg">
            Add your first child. Each child gets their own profile, lessons and progress. You can add more
            children later.
          </p>
        </div>
        <Card>
          {levels.length === 0 ? (
            <p className="text-danger font-semibold">
              No grades are available. The database migrations may not have been applied — see
              docs/development.md.
            </p>
          ) : (
            <ChildForm action={createChild} levels={levels} submitLabel="Add child" />
          )}
        </Card>
      </main>
    </>
  );
}
