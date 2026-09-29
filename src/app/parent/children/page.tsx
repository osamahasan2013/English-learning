import type { Metadata } from "next";
import Link from "next/link";
import { EnterChildModeButton } from "@/components/parent/enter-child-mode-button";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { avatarEmoji } from "@/lib/avatars";
import { listChildren } from "@/lib/server/family-data";
import { ageFromDateOfBirth } from "@/lib/utils";

export const metadata: Metadata = { title: "Children" };

export default async function ChildrenPage() {
  const children = await listChildren();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold">Children</h1>
        <Link href="/parent/children/new" className={buttonClasses("primary", "md")}>
          + Add a child
        </Link>
      </div>
      {children.length === 0 ? (
        <Card>
          <EmptyState
            icon="👨‍👩‍👧"
            title="No children yet"
            action={
              <Link href="/parent/children/new" className={buttonClasses("primary", "md")}>
                Add a child
              </Link>
            }
          >
            Each child gets their own profile, lessons and progress.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {children.map((child) => {
            const age = ageFromDateOfBirth(child.date_of_birth);
            return (
              <li key={child.id}>
                <Card className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-5xl" aria-hidden>
                      {avatarEmoji(child.avatar)}
                    </span>
                    <div>
                      <h2 className="text-xl font-bold">{child.name}</h2>
                      <p className="text-muted">
                        {child.grade?.name ?? "—"}
                        {age !== null ? ` · ${age} years old` : ""}
                      </p>
                      {child.level && child.level.id !== child.grade?.id ? (
                        <p className="text-muted text-sm">Learning at {child.level.name}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <EnterChildModeButton childId={child.id} name={child.name} size="md" />
                    <Link
                      href={`/parent/dashboard?child=${child.id}`}
                      className={buttonClasses("secondary", "md")}
                    >
                      Progress
                    </Link>
                    <Link href={`/parent/children/${child.id}`} className={buttonClasses("ghost", "md")}>
                      Edit
                    </Link>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
