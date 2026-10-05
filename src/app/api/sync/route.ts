import { NextResponse, type NextRequest } from "next/server";
import { isServerConfigured } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logging";
import { MAX_EVENTS_PER_REQUEST, syncRequestSchema } from "@/lib/offline/sync-protocol";
import { processSyncBatch } from "@/lib/server/progress-writer";
import { rateLimit } from "@/lib/server/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Receives learning events from the device outbox (src/lib/offline/outbox.ts).
//
// Authorization: the child id in the body is never trusted. The child is looked up with
// the parent's own RLS-scoped client, which only returns children of the signed-in parent;
// only then are events written (with the service role) for that child. Events recorded
// before the child's learning was reset come back "obsolete" (progress-writer.ts).

const MAX_BODY_BYTES = 512 * 1024;

export async function POST(request: NextRequest) {
  if (!isServerConfigured()) {
    logger.error("sync.not_configured");
    // 503: the device keeps the events and retries later (src/lib/offline/outbox.ts).
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logger.warn("sync.unauthenticated");
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const limit = rateLimit(`sync:${user.id}`, 60, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = syncRequestSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn("sync.invalid_request", { userId: user.id, issues: parsed.error.issues.length });
    return NextResponse.json(
      {
        error: "invalid_request",
        maxEvents: MAX_EVENTS_PER_REQUEST,
        issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    );
  }

  const { data: child } = await supabase
    .from("children")
    .select("id")
    .eq("id", parsed.data.childId)
    .maybeSingle();
  if (!child) {
    // A child that no longer exists at all was deleted (Phase 8.4): 410 tells the device to
    // drop its queued events for that child — they can never be stored. A child that exists
    // but is not this parent's (or is archived) stays a 403, and the device keeps the
    // events (they may belong to another family signed in on the same device).
    const { data: existing } = await createAdminClient()
      .from("children")
      .select("id")
      .eq("id", parsed.data.childId)
      .maybeSingle();
    if (!existing) {
      logger.warn("sync.child_deleted", { userId: user.id });
      return NextResponse.json({ error: "child_deleted" }, { status: 410 });
    }
    logger.warn("sync.child_not_owned", { userId: user.id });
    return NextResponse.json({ error: "child_not_found" }, { status: 403 });
  }

  try {
    const result = await processSyncBatch(child.id, parsed.data.events);
    const rejected = result.results.filter((r) => r.status === "rejected");
    if (rejected.length > 0) {
      logger.warn("sync.events_rejected", {
        userId: user.id,
        childId: child.id,
        count: rejected.length,
        reason: rejected[0].reason,
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    logger.error("sync.failed", {
      userId: user.id,
      childId: child.id,
      events: parsed.data.events.length,
      message: errorMessage(error),
    });
    return NextResponse.json({ error: "sync_failed" }, { status: 500 });
  }
}
