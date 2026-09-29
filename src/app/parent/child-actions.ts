"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ACTIVE_CHILD_COOKIE, getOwnedChild, requireUser } from "@/lib/auth/session";
import { AVATAR_KEYS } from "@/lib/avatars";
import { DAILY_MINUTE_OPTIONS } from "@/lib/learning/daily-plan";
import { errorMessage, logger } from "@/lib/logging";
import { listPublishedLevels } from "@/lib/server/family-data";
import { createClient } from "@/lib/supabase/server";

export type ChildFormState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
};

const childSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(40, "Use 40 characters or fewer."),
  avatar: z.enum(AVATAR_KEYS as [string, ...string[]], { message: "Choose an avatar." }),
  dateOfBirth: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine(
      (v) =>
        v === null ||
        (/^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v) < new Date() && new Date(v) > new Date("2000-01-01")),
      {
        message: "Enter a valid date of birth.",
      },
    ),
  gradeLevelId: z.string().uuid("Choose a grade."),
  dailyMinutes: z.coerce
    .number()
    .refine((n) => (DAILY_MINUTE_OPTIONS as readonly number[]).includes(n), {
      message: "Choose a daily time.",
    }),
});

function readForm(formData: FormData) {
  return childSchema.safeParse({
    name: formData.get("name"),
    avatar: formData.get("avatar"),
    dateOfBirth: formData.get("dateOfBirth") ?? undefined,
    gradeLevelId: formData.get("gradeLevelId"),
    dailyMinutes: formData.get("dailyMinutes"),
  });
}

function fieldErrors(error: z.ZodError) {
  return Object.fromEntries(error.issues.map((i) => [String(i.path[0]), i.message]));
}

export async function createChild(_prev: ChildFormState, formData: FormData): Promise<ChildFormState> {
  const user = await requireUser();
  const parsed = readForm(formData);
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
  const user = await requireUser();
  if (!(await getOwnedChild(childId))) return { status: "error", message: "This profile was not found." };
  const parsed = readForm(formData);
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  const levelId = z.string().uuid().safeParse(formData.get("currentLevelId"));
  const levels = await listPublishedLevels();
  if (!levels.some((l) => l.id === parsed.data.gradeLevelId))
    return { status: "error", fieldErrors: { gradeLevelId: "Choose a grade." } };
  if (levelId.success && !levels.some((l) => l.id === levelId.data))
    return { status: "error", fieldErrors: { currentLevelId: "Choose a level." } };

  const supabase = await createClient();
  const { error } = await supabase
    .from("children")
    .update({
      name: parsed.data.name,
      avatar: parsed.data.avatar,
      date_of_birth: parsed.data.dateOfBirth,
      grade_level_id: parsed.data.gradeLevelId,
      ...(levelId.success ? { current_level_id: levelId.data } : {}),
      daily_minutes: parsed.data.dailyMinutes,
    })
    .eq("id", childId);
  if (error) {
    logger.error("children.update_failed", { userId: user.id, childId, message: errorMessage(error) });
    return { status: "error", message: "We couldn't save the changes. Please try again." };
  }
  revalidatePath("/parent", "layout");
  redirect(`/parent/dashboard?child=${childId}`);
}

export async function archiveChild(childId: string) {
  const user = await requireUser();
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
