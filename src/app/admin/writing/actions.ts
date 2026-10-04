"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { logger } from "@/lib/logging";
import { createClient } from "@/lib/supabase/server";

// Glyph management: publish or unpublish a glyph, and tune how strictly it is judged. The
// admin's own session writes (RLS: admins only), so a parent cannot use these even if
// called directly. A draft glyph's handwriting questions are skipped in lessons; stroke
// shapes themselves are content (content/writing.json), changed through the importer.

const code = z.string().regex(/^[a-z0-9-]{2,60}$/);

export async function setGlyphStatus(formData: FormData) {
  await requireAdmin();
  const parsed = z
    .object({ code, status: z.enum(["draft", "published"]) })
    .safeParse({ code: formData.get("code"), status: formData.get("status") });
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("handwriting_glyphs")
    .update({ status: parsed.data.status })
    .eq("code", parsed.data.code);
  if (error) logger.warn("admin.glyph_status_failed", { code: parsed.data.code });
  revalidatePath("/admin/writing");
  revalidatePath(`/admin/writing/glyphs/${parsed.data.code}`);
}

export async function setGlyphThresholds(formData: FormData) {
  await requireAdmin();
  const parsed = z
    .object({
      code,
      tolerance: z.coerce.number().min(2).max(40),
      completion: z.coerce.number().min(0.3).max(0.98),
    })
    .safeParse({
      code: formData.get("code"),
      tolerance: formData.get("tolerance"),
      completion: formData.get("completion"),
    });
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("handwriting_glyphs")
    .update({ tolerance: parsed.data.tolerance, completion: parsed.data.completion })
    .eq("code", parsed.data.code);
  if (error) logger.warn("admin.glyph_thresholds_failed", { code: parsed.data.code });
  revalidatePath(`/admin/writing/glyphs/${parsed.data.code}`);
}
