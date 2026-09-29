import type { MasteryStatus } from "@/lib/learning/mastery";
import { cn } from "@/lib/utils";

// Mastery status with an icon and words, never colour alone.
export const MASTERY_LABELS: Record<MasteryStatus, { label: string; icon: string; className: string }> = {
  NOT_STARTED: { label: "Not started", icon: "○", className: "bg-surface-muted text-muted" },
  LEARNING: { label: "Learning", icon: "🌱", className: "bg-warning-soft text-warning" },
  PRACTICING: { label: "Practising", icon: "🌿", className: "bg-accent-soft text-accent" },
  ALMOST_MASTERED: { label: "Almost there", icon: "🌳", className: "bg-success-soft text-success" },
  MASTERED: { label: "Mastered", icon: "⭐", className: "bg-success text-white" },
};

export function SkillBadge({ status }: { status: MasteryStatus }) {
  const s = MASTERY_LABELS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap",
        s.className,
      )}
    >
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}
