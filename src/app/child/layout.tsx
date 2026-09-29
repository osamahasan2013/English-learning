import Link from "next/link";
import { OfflineIndicator } from "@/components/layout/offline-indicator";
import { OfflineNavigation } from "@/components/layout/offline-navigation";
import { SyncProvider } from "@/components/layout/sync-provider";
import { ParentGate } from "@/components/child/parent-gate";
import { exitChildMode } from "@/app/parent/child-actions";
import { requireActiveChild } from "@/lib/auth/session";
import { avatarEmoji } from "@/lib/avatars";

// The child area: big targets, almost no text, no links out of the app. Leaving requires
// the grown-up gate.
export default async function ChildLayout({ children }: { children: React.ReactNode }) {
  const child = await requireActiveChild();

  return (
    <SyncProvider>
      <div className="to-background flex min-h-dvh flex-col bg-gradient-to-b from-sky-100">
        <header className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 pt-4">
          <Link
            href="/child/home"
            className="bg-surface flex items-center gap-3 rounded-full py-1 pr-5 pl-1 shadow-sm"
            aria-label={`${child.name}: home`}
          >
            <span
              className="bg-accent-soft flex size-12 items-center justify-center rounded-full text-3xl"
              aria-hidden
            >
              {avatarEmoji(child.avatar)}
            </span>
            <span className="text-xl font-extrabold">{child.name}</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <OfflineIndicator variant="child" />
            <ParentGate action={exitChildMode} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
        <OfflineNavigation />
      </div>
    </SyncProvider>
  );
}
