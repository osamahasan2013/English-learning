"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNextPath } from "@/lib/auth/redirect";
import { ACTIVE_CHILD_COOKIE } from "@/lib/auth/session";
import { logger } from "@/lib/logging";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = {
  status: "idle" | "error" | "check_email";
  message?: string;
  fieldErrors?: Record<string, string>;
};

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
});
const registerSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1, "Tell us your name.").max(80),
});

function fieldErrors(error: z.ZodError) {
  return Object.fromEntries(error.issues.map((i) => [String(i.path[0]), i.message]));
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    logger.warn("auth.sign_in_failed", { code: error.code ?? error.name });
    if (error.code === "email_not_confirmed") {
      return { status: "error", message: "Please confirm your email first — check your inbox for the link." };
    }
    return { status: "error", message: "That email and password don't match an account." };
  }
  redirect(safeNextPath(formData.get("next"), "/parent/dashboard"));
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${origin}/auth/confirm?next=/onboarding`,
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
    return { status: "error", message: "We couldn't create the account. Please try again." };
  }
  // With email confirmation on, there is no session until the link is clicked.
  if (!data.session) return { status: "check_email" };
  redirect("/onboarding");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(ACTIVE_CHILD_COOKIE);
  redirect("/");
}
