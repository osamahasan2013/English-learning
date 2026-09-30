"use server";

import { revalidatePath } from "next/cache";
import { requireParentMode } from "@/lib/auth/session";
import { errorMessage, logger } from "@/lib/logging";
import { createClient } from "@/lib/supabase/server";
import { parentProfileSchema } from "@/lib/validation/family";
import { fieldErrors } from "@/lib/validation/shared";

export type ProfileFormState = {
  status: "idle" | "saved" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
};

// Updates the signed-in parent's own profile. RLS limits the update to their row and the
// column grants to display_name/locale/timezone; the role can never be changed here.
export async function updateParentProfile(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const user = await requireParentMode("/parent/settings");
  const parsed = parentProfileSchema.safeParse({
    displayName: formData.get("displayName"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.displayName, timezone: parsed.data.timezone })
    .eq("id", user.id)
    .select("id");
  if (error || !data?.length) {
    if (error?.message.includes("INVALID_TIME_ZONE")) {
      return { status: "error", fieldErrors: { timezone: "Choose a valid time zone." } };
    }
    logger.error("profile.update_failed", { userId: user.id, message: errorMessage(error) });
    return { status: "error", message: "We couldn't save your profile. Please try again." };
  }
  revalidatePath("/parent", "layout");
  return { status: "saved" };
}
