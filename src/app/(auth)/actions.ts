"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { ACTIVE_CHILD_COOKIE } from "@/lib/auth/session";
import { errorMessage, logger } from "@/lib/logging";
import { createClient } from "@/lib/supabase/server";
import { forgotPasswordSchema, newPasswordSchema, registerSchema, signInSchema } from "@/lib/validation/auth";
import { fieldErrors } from "@/lib/validation/shared";
import { isValidTimeZone } from "@/lib/validation/time-zone";

// Parent authentication (Supabase Auth, email + password). Sessions live in cookies managed
// by @supabase/ssr and are refreshed by src/proxy.ts; every protected page and action
// re-verifies the user with getUser(). Messages never reveal whether an email has an
// account, except where Supabase itself must (registering an existing address).

export type AuthFormState = {
  status: "idle" | "error" | "check_email" | "sent";
  message?: string;
  fieldErrors?: Record<string, string>;
};

async function origin() {
  const h = await headers();
  return h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

// A different parent may sign in on the same device: never carry over the previous
// family's child selection (it would be rejected anyway — RLS — but don't keep it).
async function clearActiveChild() {
  (await cookies()).delete(ACTIVE_CHILD_COOKIE);
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    logger.warn("auth.sign_in_failed", { code: error.code ?? error.name });
    if (error.code === "email_not_confirmed") {
      return { status: "error", message: "Please confirm your email first — check your inbox for the link." };
    }
    if (error.status === 429)
      return { status: "error", message: "Too many attempts. Please wait a minute and try again." };
    return { status: "error", message: "That email and password don't match an account." };
  }
  await clearActiveChild();
  redirect(safeNextPath(formData.get("next"), "/parent/dashboard"));
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
    timezone: formData.get("timezone") ?? undefined,
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };

  const timezone =
    parsed.data.timezone && isValidTimeZone(parsed.data.timezone) ? parsed.data.timezone : "UTC";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Read by public.handle_new_user() to create the parent profile.
      data: { display_name: parsed.data.displayName, timezone },
      emailRedirectTo: `${await origin()}/auth/confirm?next=/onboarding`,
    },
  });
  if (error) {
    logger.warn("auth.sign_up_failed", { code: error.code ?? error.name });
    if (error.code === "user_already_exists") {
      return { status: "error", message: "An account with this email already exists. Try logging in." };
    }
    if (error.code === "weak_password") {
      return { status: "error", fieldErrors: { password: "Choose a stronger password." } };
    }
    if (error.status === 429)
      return { status: "error", message: "Too many attempts. Please wait a minute and try again." };
    return { status: "error", message: "We couldn't create the account. Please try again." };
  }
  // With email confirmation enabled there is no session until the link is opened.
  if (!data.session) return { status: "check_email" };
  await clearActiveChild();
  redirect("/onboarding");
}

export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) logger.warn("auth.sign_out_failed", { code: error.code ?? error.name });
  await clearActiveChild();
  redirect("/");
}

// Always answers the same way, so the form cannot be used to discover which emails have
// accounts. Delivery problems are logged for the operator.
export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await origin()}/auth/confirm?next=/update-password`,
  });
  if (error) {
    if (error.status === 429)
      return { status: "error", message: "Too many requests. Please wait a minute and try again." };
    logger.error("auth.password_reset_request_failed", {
      code: error.code ?? error.name,
      message: errorMessage(error),
    });
  }
  return { status: "sent" };
}

// Reached through the reset link (/auth/confirm signs the user in with a recovery
// session) or by a signed-in parent changing their password.
export async function updatePassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Your reset link has expired. Request a new one." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    logger.warn("auth.password_update_failed", { code: error.code ?? error.name });
    if (error.code === "same_password") {
      return {
        status: "error",
        fieldErrors: { password: "Choose a password you haven't used here before." },
      };
    }
    if (error.code === "weak_password")
      return { status: "error", fieldErrors: { password: "Choose a stronger password." } };
    return { status: "error", message: "We couldn't change the password. Please try again." };
  }
  redirect("/parent/dashboard?password=updated");
}
