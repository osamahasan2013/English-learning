import "server-only";

import { errorMessage, logger } from "@/lib/logging";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// The two child lifecycle operations (Phase 8.4, ADR-046). They are deliberately separate:
//   deleteChildForParent        the child and all of their data are gone for good;
//   resetChildLearningForParent the child, profile and grade stay; their learning starts
//                               again from the beginning.
// Neither trusts the child id it is given. The signed-in parent's id comes from the verified
// session (never from the request); ownership is checked first with the parent's own
// RLS-scoped client (another family's child simply isn't there), and the database function
// checks the parent id again inside its transaction. The browser cannot call either
// function: they are granted to the service role only.

export type LifecycleResult =
  { ok: true; learningEpoch?: number } | { ok: false; reason: "not_found" | "failed" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ownedChildId(childId: string): Promise<string | null> {
  if (!UUID.test(childId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("children").select("id").eq("id", childId).maybeSingle();
  return data?.id ?? null;
}

function notFound(error: { message?: string; code?: string } | null) {
  return error?.code === "P0002" || (error?.message ?? "").includes("CHILD_NOT_FOUND");
}

export async function deleteChildForParent(parentId: string, childId: string): Promise<LifecycleResult> {
  const owned = await ownedChildId(childId);
  if (!owned) {
    logger.warn("children.delete_not_owned", { userId: parentId });
    return { ok: false, reason: "not_found" };
  }
  const { error } = await createAdminClient().rpc("delete_child", {
    p_child_id: owned,
    p_parent_id: parentId,
  });
  if (error) {
    if (notFound(error)) return { ok: false, reason: "not_found" };
    logger.error("children.delete_failed", {
      userId: parentId,
      childId: owned,
      message: errorMessage(error),
    });
    return { ok: false, reason: "failed" };
  }
  logger.info("children.deleted", { userId: parentId, childId: owned });
  return { ok: true };
}

export async function resetChildLearningForParent(
  parentId: string,
  childId: string,
): Promise<LifecycleResult> {
  const owned = await ownedChildId(childId);
  if (!owned) {
    logger.warn("children.reset_not_owned", { userId: parentId });
    return { ok: false, reason: "not_found" };
  }
  const { data, error } = await createAdminClient().rpc("reset_child_learning", {
    p_child_id: owned,
    p_parent_id: parentId,
  });
  if (error) {
    if (notFound(error)) return { ok: false, reason: "not_found" };
    logger.error("children.reset_failed", { userId: parentId, childId: owned, message: errorMessage(error) });
    return { ok: false, reason: "failed" };
  }
  logger.info("children.learning_reset", { userId: parentId, childId: owned, epoch: data });
  return { ok: true, learningEpoch: data ?? undefined };
}
