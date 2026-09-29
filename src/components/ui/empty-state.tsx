import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// "Nothing here yet" with an optional next step. Say why it's empty and what to do.
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 py-6 text-center", className)}>
      {icon ? (
        <span className="text-4xl" aria-hidden>
          {icon}
        </span>
      ) : null}
      <p className="font-bold">{title}</p>
      {children ? <div className="text-muted max-w-prose">{children}</div> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
