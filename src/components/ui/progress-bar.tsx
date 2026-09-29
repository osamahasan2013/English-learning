import { cn } from "@/lib/utils";

export function ProgressBar({
  value,
  max = 100,
  label,
  className,
  tone = "primary",
}: {
  value: number;
  max?: number;
  label: string;
  className?: string;
  tone?: "primary" | "success" | "warning" | "accent";
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const tones = { primary: "bg-primary", success: "bg-success", warning: "bg-warning", accent: "bg-accent" };
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      className={cn("bg-surface-muted h-3 w-full overflow-hidden rounded-full", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width]", tones[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
