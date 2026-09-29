import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { requireAdmin } from "@/lib/auth/session";

// Content administration. Separate from family data: admins manage curriculum content and
// have no access to children's progress (enforced by RLS, not just this layout).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <AppShell
      brandHref="/admin/dashboard"
      brand="Content admin"
      navLabel="Admin"
      nav={[
        { href: "/admin/dashboard", label: "Overview" },
        { href: "/admin/words", label: "Words" },
      ]}
      actions={
        <Link
          href="/parent/dashboard"
          className="text-muted hover:bg-surface-muted rounded-lg px-3 py-2 font-semibold"
        >
          Back to family
        </Link>
      }
    >
      {children}
    </AppShell>
  );
}
