"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveChild } from "@/lib/auth/session";
import { errorMessage, logger } from "@/lib/logging";
import { createClient } from "@/lib/supabase/server";

// My Words. The child comes from the verified active-child cookie, never from the
// browser; the database functions check again that the child is the signed-in parent's
// and the word is published (set_word_saved / note_word_seen, migration 20261004100100).

const wordId = z.string().uuid();

export type SaveWordResult = { ok: true; saved: boolean } | { ok: false };

export async function setWordSaved(id: string, saved: boolean): Promise<SaveWordResult> {
  const child = await requireActiveChild();
  const parsed = wordId.safeParse(id);
  if (!parsed.success || typeof saved !== "boolean") return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_word_saved", {
    p_child_id: child.id,
    p_word_id: parsed.data,
    p_saved: saved,
  });
  if (error) {
    logger.warn("words.save_failed", { childId: child.id, wordId: parsed.data, error: errorMessage(error) });
    return { ok: false };
  }
  revalidatePath("/child/words", "layout");
  return { ok: true, saved };
}

// Records that the child opened a word (first seen). Best effort: never blocks the page.
export async function noteWordSeen(id: string): Promise<void> {
  const child = await requireActiveChild();
  const parsed = wordId.safeParse(id);
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("note_word_seen", { p_child_id: child.id, p_word_id: parsed.data });
  if (error)
    logger.warn("words.seen_failed", { childId: child.id, wordId: parsed.data, error: errorMessage(error) });
}
