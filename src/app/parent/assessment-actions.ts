"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getOwnedChild, requireParentMode } from "@/lib/auth/session";
import { DOMAINS } from "@/lib/learning/assessment-blueprint";
import { logger } from "@/lib/logging";
import { abandonSitting, startSitting } from "@/lib/server/assessment-engine";

// Parent-side check controls (Phase 9). The child id from the form is re-verified against
// the signed-in parent (RLS) before anything happens; the server selects the questions. A
// started check waits on the child's home screen until they play it in child mode.

const startSchema = z.object({
  childId: z.string().uuid(),
  code: z.string().regex(/^[a-z0-9-]{2,80}$/),
  domain: z.enum(DOMAINS).optional(),
});

const cancelSchema = z.object({ childId: z.string().uuid(), attemptId: z.string().uuid() });

const page = (childId: string, flag: string) => `/parent/assessments?child=${childId}&${flag}`;

export async function startCheckForChild(formData: FormData) {
  await requireParentMode("/parent/assessments");
  const parsed = startSchema.safeParse({
    childId: formData.get("childId"),
    code: formData.get("code"),
    domain: formData.get("domain") || undefined,
  });
  if (!parsed.success) redirect("/parent/assessments?unavailable=1");
  const { childId, code, domain } = parsed.data;
  if (!(await getOwnedChild(childId))) redirect("/parent/assessments");
  const result = await startSitting({
    childId,
    code,
    scope: domain ? { domain } : undefined,
    origin: "parent",
  });
  if (!result.ok) {
    logger.info("assessment.parent_start_refused", { code, reason: result.reason });
    redirect(page(childId, "unavailable=1"));
  }
  revalidatePath("/parent/assessments");
  revalidatePath("/child", "layout");
  redirect(page(childId, result.resumed ? "waiting=1" : "started=1"));
}

export async function cancelCheck(formData: FormData) {
  await requireParentMode("/parent/assessments");
  const parsed = cancelSchema.safeParse({
    childId: formData.get("childId"),
    attemptId: formData.get("attemptId"),
  });
  if (!parsed.success) redirect("/parent/assessments");
  const { childId, attemptId } = parsed.data;
  const cancelled = await abandonSitting(childId, attemptId);
  revalidatePath("/parent/assessments");
  revalidatePath("/child", "layout");
  redirect(page(childId, cancelled ? "cancelled=1" : "unavailable=1"));
}
