import { AppShell, type NavItem } from "@/components/layout/app-shell";
import { OfflineIndicator } from "@/components/layout/offline-indicator";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { SyncProvider } from "@/components/layout/sync-provider";
import { getProfile, requireParentMode } from "@/lib/auth/session";
import { APP_SHORT_NAME } from "@/lib/app-info";

// Per-child sections keep the chosen child (?child=) while moving between them; every page
// re-checks it against the parent's own children.
const CHILD = ["child"];
const NAV: NavItem[] = [
  { href: "/parent/dashboard", label: "Dashboard", keepQuery: CHILD },
  { href: "/parent/progress", label: "Progress", keepQuery: CHILD },
  { href: "/parent/practice", label: "Practice", keepQuery: CHILD },
  { href: "/parent/assessments", label: "Checks", keepQuery: CHILD },
  { href: "/parent/phonics", label: "Phonics", keepQuery: CHILD },
  { href: "/parent/words", label: "Words", keepQuery: CHILD },
  { href: "/parent/spelling", label: "Spelling", keepQuery: CHILD },
  { href: "/parent/reading", label: "Reading", keepQuery: CHILD },
  { href: "/parent/writing", label: "Writing", keepQuery: CHILD },
  { href: "/parent/children", label: "Children" },
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
