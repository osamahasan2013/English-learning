import Link from "next/link";
import { avatarEmoji } from "@/lib/avatars";
import type { ChildWithLevel } from "@/lib/server/family-data";
import { cn } from "@/lib/utils";

// The child selector every per-child parent page shares (Phase 10). Links only: the page
// re-checks the chosen id against the parent's own children on the server, so a crafted
// id shows the first child, never someone else's.
export function ChildSwitcher({
  kids,
  currentId,
  basePath,
  showAdd = false,
}: {
  kids: ChildWithLevel[];
  currentId: string;
  basePath: string;
  showAdd?: boolean;
}) {
  if (kids.length < 2 && !showAdd) return null;
  return (
    <nav aria-label="Choose a child" className="flex flex-wrap gap-2">
      {kids.map((c) => (
        <Link
          key={c.id}
          href={`${basePath}?child=${c.id}`}
          aria-current={c.id === currentId ? "page" : undefined}
          className={cn(
            "flex min-h-11 items-center gap-2 rounded-full border-2 px-4 font-semibold",
            c.id === currentId ? "border-primary bg-accent-soft" : "border-border bg-surface",
          )}
        >
          <span aria-hidden>{avatarEmoji(c.avatar)}</span> {c.name}
          {c.id === currentId ? <span className="sr-only"> (showing)</span> : null}
        </Link>
      ))}
      {showAdd ? (
        <Link
          href="/parent/children/new"
          className="border-border flex min-h-11 items-center rounded-full border-2 border-dashed px-4 font-semibold"
        >
          + Add<span className="sr-only"> a child</span>
        </Link>
      ) : null}
    </nav>
  );
}
