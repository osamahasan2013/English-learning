// A learning session is one stretch of learning on a device. The device keeps the
// current session id and when it was last active; after `timeoutMinutes` without
// activity the next answer starts a new session. Every event carries the id, and the
// server derives the session's totals from those events (progress-writer.ts).

export type StoredSession = { id: string; lastActiveAt: number };

export function resolveSession(
  stored: StoredSession | null,
  now: number,
  timeoutMinutes: number,
  newId: () => string,
): StoredSession {
  if (stored && now >= stored.lastActiveAt && now - stored.lastActiveAt < timeoutMinutes * 60_000) {
    return { id: stored.id, lastActiveAt: now };
  }
  return { id: newId(), lastActiveAt: now };
}
