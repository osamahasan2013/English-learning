import Link from "next/link";
import { OfflineIndicator } from "@/components/layout/offline-indicator";
import { SyncProvider } from "@/components/layout/sync-provider";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { getProfile, requireUser } from "@/lib/auth/session";
import { APP_SHORT_NAME } from "@/lib/app-info";

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  await requireUser("/parent/dashboard");
  const profile = await getProfile();

  return (
    <SyncProvider>
      <div className="min-h-dvh">
        <header className="border-border bg-surface border-b">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/parent/dashboard" className="flex items-center gap-2 text-xl font-extrabold">
              <span aria-hidden>🌱</span> {APP_SHORT_NAME}
            </Link>
            <nav aria-label="Parent" className="flex flex-wrap gap-1">
              <Link
                className="hover:bg-surface-muted rounded-lg px-3 py-2 font-semibold"
                href="/parent/dashboard"
              >
                Dashboard
              </Link>
              <Link
                className="hover:bg-surface-muted rounded-lg px-3 py-2 font-semibold"
                href="/parent/children"
              >
                Children
              </Link>
              <Link
                className="hover:bg-surface-muted rounded-lg px-3 py-2 font-semibold"
                href="/parent/settings"
              >
                Settings
              </Link>
              {profile?.role === "admin" ? (
                <Link
                  className="hover:bg-surface-muted rounded-lg px-3 py-2 font-semibold"
                  href="/admin/dashboard"
                >
                  Content admin
                </Link>
              ) : null}
            </nav>
            <div className="ml-auto">
              <SignOutButton />
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
          <OfflineIndicator />
          {children}
        </div>
      </div>
    </SyncProvider>
  );
}
