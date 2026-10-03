import { AppShell, type NavItem } from "@/components/layout/app-shell";
import { OfflineIndicator } from "@/components/layout/offline-indicator";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { SyncProvider } from "@/components/layout/sync-provider";
import { getProfile, requireParentMode } from "@/lib/auth/session";
import { APP_SHORT_NAME } from "@/lib/app-info";

const NAV: NavItem[] = [
  { href: "/parent/dashboard", label: "Dashboard" },
  { href: "/parent/children", label: "Children" },
  { href: "/parent/phonics", label: "Phonics" },
  { href: "/parent/words", label: "Words" },
  { href: "/parent/spelling", label: "Spelling" },
  { href: "/parent/settings", label: "Settings" },
];

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  await requireParentMode("/parent/dashboard");
  const profile = await getProfile();
  const nav =
    profile?.role === "admin" ? [...NAV, { href: "/admin/dashboard", label: "Content admin" }] : NAV;

  return (
    <SyncProvider>
      <AppShell
        brandHref="/parent/dashboard"
        brand={
          <>
            <span aria-hidden>🌱</span> {APP_SHORT_NAME}
          </>
        }
        navLabel="Parent"
        nav={nav}
        actions={<SignOutButton />}
        banner={<OfflineIndicator />}
      >
        {children}
      </AppShell>
    </SyncProvider>
  );
}
