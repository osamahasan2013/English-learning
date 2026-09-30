"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ACTIVE_CHILD_COOKIE, getOwnedChild, requireParentMode, requireUser } from "@/lib/auth/session";
import { errorMessage, logger } from "@/lib/logging";
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

export async function archiveChild(childId: string) {
  const user = await requireParentMode();
  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_child", { p_child_id: childId });
  if (error) {
    logger.error("children.archive_failed", { userId: user.id, childId, message: errorMessage(error) });
    throw new Error("Could not remove the profile.");
  }
  const store = await cookies();
  if (store.get(ACTIVE_CHILD_COOKIE)?.value === childId) store.delete(ACTIVE_CHILD_COOKIE);
  revalidatePath("/parent", "layout");
  redirect("/parent/dashboard");
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
