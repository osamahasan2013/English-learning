import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/types";

// Authentication and authorization helpers for server code. The session is verified with
// getUser() (a call to Supabase Auth), never trusted from the cookie alone; RLS remains the
// real boundary for every query.

export const ACTIVE_CHILD_COOKIE = "el_active_child";

export const getSessionUser = cache(async () => {
  // Unconfigured deployment: nobody can be signed in (the root layout shows the setup
  // screen). Reading cookies keeps the route dynamic either way.
  if (!isSupabaseConfigured()) {
    await cookies();
    return null;
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getProfile = cache(async () => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return data;
});

export async function requireUser(nextPath = "/parent") {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}

// Grown-up pages and actions (parent area, settings, password change, admin). While the
// device is in child mode (a valid active-child cookie), they send the child back to the
// child area: leaving child mode goes through the grown-up gate (exitChildMode). A stale
// cookie for a child that no longer exists is ignored, so this can never loop with
// requireActiveChild.
export async function requireParentMode(nextPath = "/parent") {
  const user = await requireUser(nextPath);
  if (await getActiveChild()) redirect("/child/home");
  return user;
}

export async function requireAdmin() {
  await requireParentMode("/admin");
  const profile = await getProfile();
  // Not-found rather than "forbidden": the admin area's existence is not advertised.
  if (profile?.role !== "admin") notFound();
  return profile;
}

// Returns the child only if it belongs to the signed-in parent (RLS enforces this: another
// family's child id simply returns nothing).
export const getOwnedChild = cache(async (childId: string): Promise<Tables<"children"> | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(childId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("children").select("*").eq("id", childId).maybeSingle();
  return data;
});

export const getActiveChild = cache(async () => {
  const cookieStore = await cookies();
  const childId = cookieStore.get(ACTIVE_CHILD_COOKIE)?.value;
  if (!childId) return null;
  return getOwnedChild(childId);
});

export async function requireActiveChild() {
  await requireUser("/child/home");
  const child = await getActiveChild();
  if (!child) redirect("/parent/dashboard");
  return child;
}
