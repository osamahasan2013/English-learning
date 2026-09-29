// Progress analytics derived from stored history (never from UI state). All day
// boundaries use the family's time zone so "today" matches the parent's calendar.

export type RunSummary = {
  completedAt: string;
  durationSeconds: number;
  scorePercent: number;
};

export type DailyActivity = {
  date: string; // YYYY-MM-DD in the family's time zone
  minutes: number;
  lessons: number;
};

// A single run longer than this is capped: a tablet left open on the summary screen is
// not learning time.
export const MAX_COUNTED_RUN_SECONDS = 30 * 60;

export function localDate(value: Date | string, timeZone: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function safeTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// One entry per day for the last `days` days (oldest first), including empty days, so
// charts show gaps honestly.
export function dailyActivity(
  runs: RunSummary[],
  days: number,
  timeZone: string,
  now: Date,
): DailyActivity[] {
  const today = localDate(now, timeZone);
  const buckets = new Map<string, DailyActivity>();
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    buckets.set(date, { date, minutes: 0, lessons: 0 });
  }
  for (const run of runs) {
    const bucket = buckets.get(localDate(run.completedAt, timeZone));
    if (!bucket) continue;
    bucket.lessons += 1;
    bucket.minutes += Math.min(run.durationSeconds, MAX_COUNTED_RUN_SECONDS) / 60;
  }
  return [...buckets.values()].map((b) => ({ ...b, minutes: Math.round(b.minutes) }));
}

// Consecutive days with at least one completed lesson, ending today — or yesterday, so a
// streak is not shown as broken before the child has had a chance to learn today.
export function currentStreak(completedAt: string[], timeZone: string, now: Date) {
  const days = new Set(completedAt.map((c) => localDate(c, timeZone)));
  const today = localDate(now, timeZone);
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function totalMinutes(activity: DailyActivity[]) {
  return activity.reduce((sum, d) => sum + d.minutes, 0);
}
