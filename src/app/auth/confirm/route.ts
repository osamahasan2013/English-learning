import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { isSupabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logging";
import { createClient } from "@/lib/supabase/server";

// Target of the confirmation link in the sign-up email.
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.redirect(new URL("/", request.url));
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"), "/onboarding");

  const code = searchParams.get("code");
  const supabase = await createClient();

  // Custom email template link (token hash) or the default PKCE redirect (?code=).
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
    logger.warn("auth.confirm_failed", { code: error.code ?? error.name });
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
    logger.warn("auth.confirm_failed", { code: error.code ?? error.name });
  }
  return NextResponse.redirect(new URL("/login?error=confirmation", request.url));
}
