"use client";

import { signOut } from "@/app/(auth)/actions";
import { getLearningDb } from "@/lib/offline/db";

// Signing out removes this family's saved pages and lessons from the device (shared
// tablets). Unsynced answers stay in the outbox: they are only ever accepted for a child
// of the parent who signs in next, and are otherwise kept and reported, never dropped.
export function SignOutButton() {
  async function clearDeviceCopies() {
    try {
      if ("caches" in window) await caches.delete("pages");
      await getLearningDb().lessons.clear();
    } catch {
      // Best effort; signing out must still work.
    }
  }
  return (
    <form action={signOut} onSubmit={() => void clearDeviceCopies()}>
      <button type="submit" className="text-muted hover:bg-surface-muted rounded-lg px-3 py-2 font-semibold">
        Log out
      </button>
    </form>
  );
}
