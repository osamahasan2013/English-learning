import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChildForm } from "@/components/parent/child-form";
import { Card } from "@/components/ui/card";
import { updateChild } from "@/app/parent/child-actions";
import { getOwnedChild } from "@/lib/auth/session";
import { listPublishedLevels } from "@/lib/server/family-data";
import { DeleteChildControl, ResetLearningControl } from "./lifecycle-controls";

export const metadata: Metadata = { title: "Child settings" };

export default async function ChildSettingsPage(props: PageProps<"/parent/children/[childId]">) {
  const { childId } = await props.params;
  const [child, levels] = await Promise.all([getOwnedChild(childId), listPublishedLevels()]);
  if (!child) notFound();
  const gradeName = levels.find((l) => l.id === child.grade_level_id)?.name ?? "grade";

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-3xl font-extrabold">{child.name}&apos;s settings</h1>
      <Card>
        <ChildForm
          action={updateChild.bind(null, child.id)}
          levels={levels}
          submitLabel="Save changes"
          initial={{
            name: child.name,
            avatar: child.avatar,
            dateOfBirth: child.date_of_birth,
            gradeLevelId: child.grade_level_id,
            currentLevelId: child.current_level_id,
            dailyMinutes: child.daily_minutes,
          }}
        />
      </Card>
      <Card className="space-y-3" aria-labelledby="learning-heading">
        <h2 id="learning-heading" className="text-lg font-bold">
          Learning
        </h2>
        <h3 className="font-semibold">Reset learning</h3>
        <p className="text-muted">
          Start {child.name}&apos;s learning journey again from the beginning. Their profile and {gradeName}{" "}
          stay.
        </p>
        <ResetLearningControl childId={child.id} name={child.name} gradeName={gradeName} />
      </Card>
      <Card className="border-danger/40 space-y-3" aria-labelledby="danger-heading">
        <h2 id="danger-heading" className="text-lg font-bold">
          <span aria-hidden>⚠️ </span>Danger zone
        </h2>
        <h3 className="font-semibold">Delete child</h3>
        <p className="text-muted">
          Permanently delete {child.name} and all of their learning data. This can&apos;t be undone.
        </p>
        <DeleteChildControl childId={child.id} name={child.name} />
      </Card>
    </div>
  );
}
