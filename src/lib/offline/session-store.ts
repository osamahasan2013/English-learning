import { resolveSession, type StoredSession } from "@/lib/learning/learning-session";
import { newId } from "@/lib/uuid";

// The device's current learning session per child (see learning-session.ts). Kept in
// localStorage: it is a per-device convenience, and if storage is unavailable every
// event simply starts or continues an in-memory session.

const memory = new Map<string, StoredSession>();
const key = (childId: string) => `el_session_${childId}`;

export function currentSessionId(childId: string, timeoutMinutes: number, now = Date.now()): string {
  let stored: StoredSession | null = memory.get(childId) ?? null;
  try {
    const raw = localStorage.getItem(key(childId));
    if (raw) stored = JSON.parse(raw) as StoredSession;
  } catch {
    // Private mode or blocked storage: fall back to memory.
  }
  const next = resolveSession(stored, now, timeoutMinutes, newId);
  memory.set(childId, next);
  try {
    localStorage.setItem(key(childId), JSON.stringify(next));
  } catch {
    // Ignored, see above.
  }
  return next.id;
}

// Forgets the device's session for a child (deleted, or learning reset).
export function forgetSession(childId: string) {
  memory.delete(childId);
  try {
    localStorage.removeItem(key(childId));
  } catch {
    // Ignored, see above.
  }
}
