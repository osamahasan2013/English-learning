"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { logger } from "@/lib/logging";
import { createClient } from "@/lib/supabase/server";

// Publish or unpublish a reading text. The admin's own session writes (RLS: admins only), so
// this cannot be used by a parent even if called directly. A draft text disappears from the
// library and its reading step is skipped in lessons until it is published again.

const fields = z.object({
  code: z.string().regex(/^[a-z0-9-]{2,80}$/),
  status: z.enum(["draft", "published"]),
});

export async function setStoryStatus(formData: FormData) {
  await requireAdmin();
  const parsed = fields.safeParse({ code: formData.get("code"), status: formData.get("status") });
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("stories")
    .update({ status: parsed.data.status })
    .eq("code", parsed.data.code);
  if (error) {
    logger.warn("admin.story_status_failed", { code: parsed.data.code });
    return;
  }
  revalidatePath("/admin/reading");
  revalidatePath(`/admin/reading/${parsed.data.code}`);
}
