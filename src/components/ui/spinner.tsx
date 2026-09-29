import { cn } from "@/lib/utils";

// Loading indicator with an accessible label. Honors reduced motion via globals.css.
export function Spinner({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn("text-muted inline-flex items-center gap-2", className)}>
      <span
        aria-hidden
        className="border-border border-t-primary size-5 animate-spin rounded-full border-[3px]"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
