"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// A navigation link that marks itself as the current page (aria-current + style).
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
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
