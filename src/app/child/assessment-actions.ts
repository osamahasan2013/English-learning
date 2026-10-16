"use server";

import { redirect } from "next/navigation";
import { requireActiveChild } from "@/lib/auth/session";
import { logger } from "@/lib/logging";
import { startSitting } from "@/lib/server/assessment-engine";

// Starts (or resumes) a check for the active child (Phase 9). The child comes from the
// verified active-child cookie, never from the form; the form may only name a check and, for
// a re-check, the skill — the server selects the questions. Starting happens in an action,
// never while rendering a page, so a prefetched link cannot open a sitting.
export async function startCheck(formData: FormData) {
  const child = await requireActiveChild();
  const code = String(formData.get("code") ?? "");
  const skill = String(formData.get("skill") ?? "");
  const result = await startSitting({
    childId: child.id,
    code,
    scope: skill ? { skillIds: [skill] } : undefined,
    origin: skill ? "recommendation" : "child",
  });
  if (!result.ok) {
    logger.info("assessment.start_refused", { code, reason: result.reason });
    redirect(`/child/check/${encodeURIComponent(code)}?unavailable=1`);
  }
  redirect(`/child/assess/${result.attemptId}`);
}
