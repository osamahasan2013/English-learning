import type { DailyActivity } from "@/lib/learning/analytics";

// Minutes learned per day. A simple bar chart with the exact numbers available to
// screen readers as a table, and each bar labelled for sighted users on hover/focus.
export function ActivityChart({ days, dailyGoal }: { days: DailyActivity[]; dailyGoal: number }) {
  const max = Math.max(dailyGoal, ...days.map((d) => d.minutes), 1);
  const weekday = (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" });
  const long = (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  return (
    <figure className="space-y-2">
      <div className="relative flex h-40 items-end gap-1.5" aria-hidden>
        <div
          className="border-success/60 absolute inset-x-0 border-t-2 border-dashed"
          style={{ bottom: `${(dailyGoal / max) * 100}%` }}
        />
        {days.map((d) => (
          <div
            key={d.date}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${long(d.date)}: ${d.minutes} min, ${d.lessons} lessons`}
          >
            <div
              className={d.minutes >= dailyGoal ? "bg-success rounded-t-md" : "bg-primary/70 rounded-t-md"}
              style={{ height: `${Math.max(d.minutes > 0 ? 4 : 0, (d.minutes / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="text-muted flex gap-1.5 text-center text-xs" aria-hidden>
        {days.map((d) => (
          <span key={d.date} className="flex-1">
            {weekday(d.date)}
          </span>
        ))}
      </div>
      <figcaption className="text-muted text-sm">
        Minutes of lessons per day, last {days.length} days. Dashed line: daily goal ({dailyGoal} min).
      </figcaption>
      <table className="sr-only">
        <caption>Learning minutes per day</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Minutes</th>
            <th>Lessons</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{long(d.date)}</td>
              <td>{d.minutes}</td>
              <td>{d.lessons}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
