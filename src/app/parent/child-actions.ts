"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ACTIVE_CHILD_COOKIE, getOwnedChild, requireParentMode, requireUser } from "@/lib/auth/session";
import { errorMessage, logger } from "@/lib/logging";
import { deleteChildForParent, resetChildLearningForParent } from "@/lib/server/child-lifecycle";
import { listPublishedLevels } from "@/lib/server/family-data";
import { createClient } from "@/lib/supabase/server";
import { MAX_CHILDREN_PER_FAMILY, readChildProfileForm } from "@/lib/validation/family";
import { fieldErrors } from "@/lib/validation/shared";

export type ChildFormState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
};

// Database rule violations (migration 20260930100100) → messages for the parent.
function childSaveError(error: { message?: string } | null) {
  const message = error?.message ?? "";
  if (message.includes("CHILD_LIMIT_REACHED")) {
    return `A family account can have up to ${MAX_CHILDREN_PER_FAMILY} children.`;
  }
  if (message.includes("LEVEL_NOT_AVAILABLE")) return "That grade is no longer available. Choose another.";
  return null;
}

export async function createChild(_prev: ChildFormState, formData: FormData): Promise<ChildFormState> {
  const user = await requireParentMode();
  const parsed = readChildProfileForm(formData);
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  const levels = await listPublishedLevels();
  if (!levels.some((l) => l.id === parsed.data.gradeLevelId))
    return { status: "error", fieldErrors: { gradeLevelId: "Choose a grade." } };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("children")
    .insert({
      name: parsed.data.name,
      avatar: parsed.data.avatar,
      date_of_birth: parsed.data.dateOfBirth,
      grade_level_id: parsed.data.gradeLevelId,
      // Starts at the selected grade; a placement assessment or the parent can change it.
      current_level_id: parsed.data.gradeLevelId,
      daily_minutes: parsed.data.dailyMinutes,
    })
    .select("id")
    .single();
  if (error || !data) {
    const known = childSaveError(error);
    if (known) return { status: "error", message: known };
    logger.error("children.create_failed", { userId: user.id, message: errorMessage(error) });
    return { status: "error", message: "We couldn't save the profile. Please try again." };
  }
  revalidatePath("/parent", "layout");
  redirect(`/parent/dashboard?child=${data.id}`);
}

export async function updateChild(
  childId: string,
  _prev: ChildFormState,
  formData: FormData,
): Promise<ChildFormState> {
  const user = await requireParentMode();
  if (!(await getOwnedChild(childId))) return { status: "error", message: "This profile was not found." };
  const parsed = readChildProfileForm(formData);
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  const levels = await listPublishedLevels();
  if (!levels.some((l) => l.id === parsed.data.gradeLevelId))
    return { status: "error", fieldErrors: { gradeLevelId: "Choose a grade." } };
  const currentLevelId = parsed.data.currentLevelId;
  if (currentLevelId && !levels.some((l) => l.id === currentLevelId))
    return { status: "error", fieldErrors: { currentLevelId: "Choose a level." } };

  const supabase = await createClient();
  const { error } = await supabase
    .from("children")
    .update({
      name: parsed.data.name,
      avatar: parsed.data.avatar,
      date_of_birth: parsed.data.dateOfBirth,
      grade_level_id: parsed.data.gradeLevelId,
      ...(currentLevelId ? { current_level_id: currentLevelId } : {}),
      daily_minutes: parsed.data.dailyMinutes,
    })
    .eq("id", childId);
  if (error) {
    const known = childSaveError(error);
    if (known) return { status: "error", message: known };
    logger.error("children.update_failed", { userId: user.id, childId, message: errorMessage(error) });
    return { status: "error", message: "We couldn't save the changes. Please try again." };
  }
  revalidatePath("/parent", "layout");
  redirect(`/parent/dashboard?child=${childId}`);
}

// Child lifecycle (Phase 8.4, ADR-046). Two separate actions; the server decides what each
// one removes, the child id from the browser is re-verified, and success is reported only
// after the database transaction committed. The client then clears this device's data for
// the child (src/lib/offline/child-data.ts) and refreshes.
export type LifecycleActionResult = { ok: true } | { ok: false; message: string };

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export async function deleteChild(childId: string, confirmName: string): Promise<LifecycleActionResult> {
  const user = await requireParentMode();
  const child = await getOwnedChild(childId);
  if (!child) return { ok: false, message: "This profile was not found." };
  // The typed name is checked here too: deleting needs the parent's explicit confirmation.
  if (!sameName(confirmName, child.name)) return { ok: false, message: `Type ${child.name} to confirm.` };
  const result = await deleteChildForParent(user.id, child.id);
  if (!result.ok)
    return {
      ok: false,
      message:
        result.reason === "not_found"
          ? "This profile was not found."
          : "We couldn't delete the profile. Nothing was changed. Please try again.",
    };
  const store = await cookies();
  if (store.get(ACTIVE_CHILD_COOKIE)?.value === child.id) store.delete(ACTIVE_CHILD_COOKIE);
  revalidatePath("/parent", "layout");
  revalidatePath("/child", "layout");
  return { ok: true };
}

export async function resetChildLearning(childId: string): Promise<LifecycleActionResult> {
  const user = await requireParentMode();
  const result = await resetChildLearningForParent(user.id, childId);
  if (!result.ok)
    return {
      ok: false,
      message:
        result.reason === "not_found"
          ? "This profile was not found."
          : "We couldn't reset the learning. Nothing was changed. Please try again.",
    };
  revalidatePath("/parent", "layout");
  revalidatePath("/child", "layout");
  return { ok: true };
}

// Hands the device to a child: remembers which child is learning (httpOnly cookie,
// re-verified against the parent's account on every child page).
export async function enterChildMode(childId: string) {
  await requireUser();
  const child = await getOwnedChild(childId);
  if (!child) redirect("/parent/dashboard");
  (await cookies()).set(ACTIVE_CHILD_COOKIE, child.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/child/home");
}

export async function exitChildMode() {
  (await cookies()).delete(ACTIVE_CHILD_COOKIE);
  redirect("/parent/dashboard");
}
