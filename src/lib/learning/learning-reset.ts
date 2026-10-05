import type { SyncEvent } from "@/lib/offline/sync-protocol";

// Learning reset (Phase 8.4, ADR-046): is a synced event from before the child's learning
// was reset? Such an event is obsolete — storing it would bring the old progress back.
//   * An event that carries the epoch it was recorded in is obsolete when that epoch is
//     older than the child's current one (a device that hadn't seen the reset).
//   * An event without an epoch (queued by an app version from before Phase 8.4) is
//     obsolete when it happened before the reset. A run or reading counts from its start:
//     a lesson begun before the reset belongs to the old journey.
// Pure; the progress writer applies it before anything is stored.

export type ResetState = { learningEpoch: number; learningResetAt: string | null };

export function eventTime(event: SyncEvent): string {
  switch (event.kind) {
    case "attempt":
      return event.attemptedAt;
    case "lesson_run":
    case "assessment_run":
    case "reading":
      return event.startedAt;
  }
}

export function isObsoleteEvent(event: SyncEvent, state: ResetState): boolean {
  if (event.epoch !== undefined) return event.epoch < state.learningEpoch;
  if (!state.learningResetAt) return false;
  return Date.parse(eventTime(event)) < Date.parse(state.learningResetAt);
}
