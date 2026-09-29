import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { isSupabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logging";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_TYPES: EmailOtpType[] = ["signup", "email", "recovery", "email_change", "invite", "magiclink"];

// A same-site path, sent as a relative Location. Building an absolute URL from request.url
// can name a different host than the one the browser used (e.g. localhost vs 127.0.0.1,
// or an internal host behind a proxy), which would drop the session cookie just set here.
function redirectTo(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

// Target of links in auth emails: sign-up confirmation (next=/onboarding) and password
// recovery (next=/update-password). Accepts the token-hash link format and the default
// PKCE redirect (?code=).
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) return redirectTo("/");
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const type = ALLOWED_TYPES.find((t) => t === rawType);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"), "/onboarding");

  const supabase = await createClient();
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return redirectTo(next);
    logger.warn("auth.confirm_failed", { code: error.code ?? error.name, type });
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirectTo(next);
    logger.warn("auth.confirm_failed", { code: error.code ?? error.name, type: "code" });
  }
  return redirectTo("/login?error=confirmation");
}
