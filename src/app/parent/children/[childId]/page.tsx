import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChildForm } from "@/components/parent/child-form";
import { Card } from "@/components/ui/card";
import { archiveChild, updateChild } from "@/app/parent/child-actions";
import { getOwnedChild } from "@/lib/auth/session";
import { listPublishedLevels } from "@/lib/server/family-data";
import { ArchiveChildButton } from "./archive-child-button";

export const metadata: Metadata = { title: "Edit child" };

export default async function EditChildPage(props: PageProps<"/parent/children/[childId]">) {
  const { childId } = await props.params;
  const [child, levels] = await Promise.all([getOwnedChild(childId), listPublishedLevels()]);
  if (!child) notFound();

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-3xl font-extrabold">Edit {child.name}</h1>
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
      <Card className="border-danger/40 space-y-3">
        <h2 className="text-lg font-bold">Remove profile</h2>
        <p className="text-muted">
          Removes {child.name} from your family account. Their learning history is kept on the server but no
          longer shown.
        </p>
        <ArchiveChildButton action={archiveChild.bind(null, child.id)} name={child.name} />
      </Card>
    </div>
  );
}
