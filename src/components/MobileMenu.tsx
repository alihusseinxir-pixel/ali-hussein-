"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Full navigation for small screens (the sidebar is desktop-only). Closes itself after every navigation. */
export function MobileMenu({ items, userLine, signOut, accountLabel, signOutLabel, menuLabel }: {
  items: { href: string; label: string }[]; userLine: string; signOut: () => Promise<void>;
  accountLabel: string; signOutLabel: string; menuLabel: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => { if (ref.current) ref.current.open = false; }, [pathname]);
  return (
    <details ref={ref} className="relative md:hidden">
      <summary className="btn-secondary cursor-pointer list-none !px-3 !py-1.5" aria-label={menuLabel}>☰ {menuLabel}</summary>
      <nav className="absolute end-0 z-30 mt-2 w-64 rounded-lg border bg-white p-2 shadow-lg" aria-label={menuLabel}>
        <p className="truncate border-b px-3 pb-2 text-xs text-slate-500">{userLine}</p>
        <ul className="py-1">
          {items.map((n) => <li key={n.href}><Link href={n.href} className="block rounded-md px-3 py-2 text-sm hover:bg-slate-100">{n.label}</Link></li>)}
        </ul>
        <div className="flex items-center justify-between border-t px-3 pt-2 text-sm">
          <Link href="/account" className="text-brand-600 underline">{accountLabel}</Link>
          <form action={signOut}><button className="text-slate-600 underline">{signOutLabel}</button></form>
        </div>
      </nav>
    </details>
  );
}
