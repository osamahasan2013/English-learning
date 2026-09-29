import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  error: { box: "bg-danger-soft text-danger", icon: "⚠️" },
  warning: { box: "bg-warning-soft text-warning", icon: "⚠️" },
  success: { box: "bg-success-soft text-success", icon: "✓" },
  info: { box: "bg-accent-soft text-accent", icon: "ℹ️" },
} as const;

// Inline message. Errors are announced immediately (role="alert"); other tones politely.
// Tone is conveyed by icon and text, not colour alone.
export function Alert({
  tone,
  title,
  children,
  className,
}: {
  tone: keyof typeof tones;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const t = tones[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-xl px-4 py-3 font-semibold", t.box, className)}
    >
      <span aria-hidden className="shrink-0">
        {t.icon}
      </span>
      <div className="space-y-1">
        {title ? <p className="font-bold">{title}</p> : null}
        {children ? <div className={cn(title && "font-normal")}>{children}</div> : null}
      </div>
    </div>
  );
}
