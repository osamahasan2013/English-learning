import "server-only";

// Sliding-window rate limiter kept in memory. Per server instance: good enough to stop a
// runaway client loop on one instance; a multi-instance deployment should move this to a
// shared store (docs/decisions.md, ADR-009).
const windows = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const recent = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    windows.set(key, recent);
    return { ok: false as const, retryAfterSeconds: Math.ceil((windowMs - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  windows.set(key, recent);
  if (windows.size > 10_000) {
    for (const [k, times] of windows) if (times.every((t) => now - t >= windowMs)) windows.delete(k);
  }
  return { ok: true as const };
}
