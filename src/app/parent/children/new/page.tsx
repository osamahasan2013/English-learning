import type { Metadata } from "next";
import { ChildForm } from "@/components/parent/child-form";
import { Card } from "@/components/ui/card";
import { createChild } from "@/app/parent/child-actions";
import { listPublishedLevels } from "@/lib/server/family-data";

export const metadata: Metadata = { title: "Add a child" };

export default async function NewChildPage() {
  const levels = await listPublishedLevels();
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-3xl font-extrabold">Add a child</h1>
      <Card>
        <ChildForm action={createChild} levels={levels} submitLabel="Add child" />
      </Card>
    </div>
  );
}
