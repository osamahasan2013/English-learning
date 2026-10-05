"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteChild, resetChildLearning } from "@/app/parent/child-actions";
import { clearChildLocalData } from "@/lib/offline/child-data";

// Child lifecycle (Phase 8.4): two separate actions with their own confirmation. The
// server does the work; only after it reports success does this device forget its data
// for the child (unsynced events, lessons in progress, the learning session) and refresh.

export function ResetLearningControl({
  childId,
  name,
  gradeName,
}: {
  childId: string;
  name: string;
  gradeName: string;
}) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-2">
      <ConfirmDialog
        triggerLabel={`Reset ${name}'s learning…`}
        title={`Reset learning for ${name}?`}
        confirmLabel="Reset learning"
        pendingLabel="Resetting…"
        onConfirm={async () => {
          setDone(false);
          const result = await resetChildLearning(childId);
          if (!result.ok) return result.message;
          await clearChildLocalData(childId);
          setDone(true);
          router.refresh();
          return null;
        }}
      >
        <p>
          This removes {name}&apos;s learning progress — lessons, stars, skills, words, review and checks —
          and starts the learning journey again from the beginning.
        </p>
        <p>
          {name}&apos;s profile and {gradeName} assignment stay. This can&apos;t be undone.
        </p>
      </ConfirmDialog>
      {done ? (
        <p role="status" className="font-semibold">
          <span aria-hidden>✅ </span>
          {name}&apos;s learning was reset. They start again from the beginning.
        </p>
      ) : null}
    </div>
  );
}

export function DeleteChildControl({ childId, name }: { childId: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      triggerLabel={`Delete ${name}…`}
      triggerVariant="danger"
      title={`Delete ${name} permanently?`}
      confirmLabel={`Delete ${name}`}
      pendingLabel="Deleting…"
      typeToConfirm={name}
      onConfirm={async () => {
        const result = await deleteChild(childId, name);
        if (!result.ok) return result.message;
        await clearChildLocalData(childId);
        router.replace("/parent/dashboard");
        router.refresh();
        return null;
      }}
    >
      <p>
        This permanently deletes {name}&apos;s profile and all of {name}&apos;s learning data: progress,
        answers, stars, words, reading, writing and checks.
      </p>
      <p className="font-semibold">
        This can&apos;t be undone. Your account and your other children are not affected.
      </p>
    </ConfirmDialog>
  );
}
