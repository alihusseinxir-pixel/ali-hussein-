import Link from "next/link";
import { requireUser } from "@/lib/session";
import { dashboardCounts, listTasks } from "@/lib/tasks";
import { can } from "@/lib/rbac";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/datetime";
import { listCalendarEvents } from "@/lib/calendar-query";
import { EVENT_COLORS, dayKey, daysFor, timeLabel, utcRange } from "@/lib/calendar";
import { PriorityBadge, StageBadge } from "@/components/Badges";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const { denied } = await searchParams;
  const c = await dashboardCounts(user);
  const mine = await listTasks(user, { mine: true, sort: "deadline" });
  const todayKey = dayKey(new Date(), env.timezone);
  const { from, to } = utcRange(daysFor("day", todayKey), env.timezone);
  const today = await listCalendarEvents(user, { from, to, mine: true });
  const scope = can(user.role, "task:view:all") ? "" : " (your tasks)";
  const tiles: [string, number, string?][] = [
    ["Total tasks", c.total], ["In production", c.inProduction], ["Editing / design", c.editing],
    ["Waiting review", c.waitingReview], ["Waiting approval", c.waitingApproval], ["Scheduled", c.scheduled],
    ["Published", c.published], ["Completed", c.completed], ["Overdue", c.overdue, c.overdue ? "text-red-600" : ""],
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Welcome, {user.name.split(" ")[0]}</h1>
      {denied && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">You do not have access to that page.</p>}
      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-500">Overview{scope}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map(([label, n, cls]) => (
            <div key={label} className="card !p-4"><div className={`text-2xl font-semibold ${cls ?? ""}`}>{n}</div><div className="text-xs text-slate-500">{label}</div></div>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">Today</h2><Link className="text-sm text-brand-600 underline" href="/calendar?view=day">Open calendar</Link></div>
        {today.length === 0 ? <p className="text-sm text-slate-500">Nothing scheduled for you today.</p> : (
          <ul className="divide-y">
            {today.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-12 font-semibold">{timeLabel(e.startsAt, env.timezone)}</span>
                <span className={`rounded border px-1.5 py-0.5 text-xs ${EVENT_COLORS[e.type].cls}`}>{EVENT_COLORS[e.type].label}</span>
                <Link href={`/tasks/${e.task.id}`} className="hover:underline">{e.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">My tasks</h2><Link className="text-sm text-brand-600 underline" href="/tasks?mine=1">View all</Link></div>
        {mine.items.length === 0 ? <p className="text-sm text-slate-500">Nothing assigned to you right now.</p> : (
          <ul className="divide-y">
            {mine.items.slice(0, 6).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div><Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link><div className="text-xs text-slate-400">{t.taskCode} · due {formatDateTime(t.deadline, env.timezone)}</div></div>
                <div className="flex gap-2"><PriorityBadge p={t.priority} /><StageBadge s={t.stage} /></div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
