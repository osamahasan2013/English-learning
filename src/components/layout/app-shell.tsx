import Link from "next/link";
import type { ReactNode } from "react";
import { NavLink } from "@/components/layout/nav-link";

export type NavItem = { href: string; label: string };

// Shell for the grown-up areas (parent, admin): brand, primary navigation, actions, and
// a <main> landmark the skip link targets. On narrow screens the navigation becomes a
// horizontally scrollable row below the brand instead of wrapping.
export function AppShell({
  brandHref,
  brand,
  navLabel,
  nav,
  actions,
  banner,
  children,
}: {
  brandHref: string;
  brand: ReactNode;
  navLabel: string;
  nav: NavItem[];
  actions?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="border-border bg-surface border-b">
        <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto] items-center gap-x-4 px-4 pt-3 sm:flex sm:py-3">
          <Link href={brandHref} className="flex items-center gap-2 text-xl font-extrabold">
            {brand}
          </Link>
          <div className="justify-self-end sm:order-last sm:ml-auto">{actions}</div>
          <nav
            aria-label={navLabel}
            className="col-span-2 -mx-4 flex gap-1 overflow-x-auto px-4 py-2 sm:mx-0 sm:px-0 sm:py-0"
          >
            {nav.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        {banner}
        {children}
      </main>
    </div>
  );
}
