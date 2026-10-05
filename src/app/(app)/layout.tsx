import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can, ROLE_LABELS, type Permission } from "@/lib/rbac";
import { NotificationBell } from "@/components/NotificationBell";
import { logoutAction } from "@/app/actions/auth";

interface NavItem { href: string; label: string; need?: Permission; soon?: string }
const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/tasks?mine=1", label: "My Tasks" },
  { href: "/tasks", label: "Tasks" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/calendar", label: "Calendar" },
  { href: "/approvals", label: "Approvals", need: "approval:internal" },
  { href: "/team", label: "Team", need: "user:manage" },
  { href: "/templates", label: "Templates", soon: "Phase 9" },
  { href: "/files", label: "Files" },
  { href: "/notifications", label: "Notifications" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col bg-brand-900 p-4 text-slate-200 md:flex">
        <div className="mb-6 px-2 text-lg font-bold leading-tight text-white">BASMA<br /><span className="text-sm font-medium tracking-widest text-brand-100">MARKETING</span></div>
        <nav className="flex-1 space-y-1">
          {NAV.filter((n) => !n.need || can(user.role, n.need)).map((n) =>
            n.soon ? (
              <span key={n.href} className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-slate-500" title={`Coming in ${n.soon}`}>
                {n.label}<span className="text-[10px] uppercase">{n.soon}</span>
              </span>
            ) : (
              <Link key={n.href} href={n.href} className="block rounded-md px-3 py-2 text-sm hover:bg-white/10">{n.label}</Link>
            ),
          )}
        </nav>
        <div className="border-t border-white/10 pt-3 text-xs">
          <div className="truncate font-medium text-white">{user.name}</div>
          <div className="truncate text-slate-400">{ROLE_LABELS[user.role]} · {user.organization.name}</div>
          <form action={logoutAction}><button className="mt-2 text-slate-300 underline hover:text-white">Sign out</button></form>
        </div>
      </aside>
      <div className="flex-1 overflow-x-auto">
        <header className="flex items-center justify-between border-b bg-white px-4 py-2">
          <span className="font-bold text-brand-900 md:invisible">BASMA MARKETING</span>
          <div className="flex items-center gap-3">
            <nav className="flex gap-3 text-sm md:hidden"><Link href="/dashboard">Home</Link><Link href="/tasks">Tasks</Link><Link href="/calendar">Calendar</Link></nav>
            <NotificationBell />
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
