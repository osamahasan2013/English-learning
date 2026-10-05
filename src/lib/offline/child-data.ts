import { getLearningDb } from "@/lib/offline/db";
import { forgetSession } from "@/lib/offline/session-store";

// Removes everything this device keeps for one child (Phase 8.4): events not yet synced,
// lessons in progress and the learning session. Called after the child was deleted or
// their learning was reset — events recorded before that can never be stored (the server
// answers 410 / "obsolete"), and a resumed lesson would show the old journey. Cached lesson
// content is shared by every child and stays. Never throws: a device without IndexedDB has
// nothing to remove.
export async function clearChildLocalData(childId: string) {
  forgetSession(childId);
  try {
    const db = getLearningDb();
    await db.transaction("rw", db.outbox, db.runs, async () => {
      await db.outbox.filter((item) => item.childId === childId).delete();
      await db.runs.where("key").startsWith(`${childId}:`).delete();
    });
  } catch {
    // IndexedDB unavailable or blocked: nothing was stored on this device.
  }
}
