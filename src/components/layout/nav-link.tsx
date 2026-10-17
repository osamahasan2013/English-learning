"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { cn } from "@/lib/utils";

// A navigation link that marks itself as the current page (aria-current + style).
// `keepQuery` carries those query parameters of the current URL over to the link (the
// parent area keeps the chosen child while moving between sections; each page still
// re-checks the id against the parent's own children).
export function NavLink({
  href,
  children,
  keepQuery,
}: {
  href: string;
  children: React.ReactNode;
  keepQuery?: string[];
}) {
  if (!keepQuery?.length) return <NavAnchor href={href}>{children}</NavAnchor>;
  return (
    <Suspense fallback={<NavAnchor href={href}>{children}</NavAnchor>}>
      <QueryNavLink href={href} keepQuery={keepQuery}>
        {children}
      </QueryNavLink>
    </Suspense>
  );
}

function QueryNavLink({
  href,
  children,
  keepQuery,
}: {
  href: string;
  children: React.ReactNode;
  keepQuery: string[];
}) {
  const params = useSearchParams();
  const kept = new URLSearchParams();
  for (const key of keepQuery) {
    const value = params.get(key);
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  return (
    <NavAnchor href={query ? `${href}?${query}` : href} match={href}>
      {children}
    </NavAnchor>
  );
}

function NavAnchor({
  href,
  match = href,
  children,
}: {
  href: string;
  match?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === match || pathname.startsWith(`${match}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "shrink-0 rounded-lg px-3 py-2 font-semibold whitespace-nowrap transition",
        active ? "bg-accent-soft text-accent" : "hover:bg-surface-muted",
      )}
    >
      {children}
    </Link>
  );
}
