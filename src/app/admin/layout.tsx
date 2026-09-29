import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";

// Content administration. Separate from family data: admins manage curriculum content and
// have no access to children's progress (enforced by RLS, not just this layout).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="min-h-dvh">
      <header className="border-border bg-surface border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="text-xl font-extrabold">Content admin</span>
          <nav aria-label="Admin" className="flex gap-1">
            <Link
              className="hover:bg-surface-muted rounded-lg px-3 py-2 font-semibold"
              href="/admin/dashboard"
            >
              Overview
            </Link>
            <Link className="hover:bg-surface-muted rounded-lg px-3 py-2 font-semibold" href="/admin/words">
              Words
            </Link>
          </nav>
          <Link
            href="/parent/dashboard"
            className="text-muted hover:bg-surface-muted ml-auto rounded-lg px-3 py-2 font-semibold"
          >
            Back to family
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}
