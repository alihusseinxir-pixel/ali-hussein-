import Link from "next/link";
import type { CalendarEventType } from "@prisma/client";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { env } from "@/lib/env";
import { listCalendarEvents } from "@/lib/calendar-query";
import { EVENT_COLORS, addDays, addMonths, dayKey, daysFor, isDayKey, utcRange, type CalendarView } from "@/lib/calendar";
import { MonthView } from "@/components/calendar/MonthView";
import { TimeGrid } from "@/components/calendar/TimeGrid";

type SP = { view?: string; date?: string; types?: string; mine?: string };
const TYPES = Object.keys(EVENT_COLORS) as CalendarEventType[];

export default async function CalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tz = env.timezone;
  const today = dayKey(new Date(), tz);
  const view: CalendarView = sp.view === "week" || sp.view === "day" ? sp.view : "month";
  const anchor = isDayKey(sp.date) ? sp.date : today;
  const active = (sp.types ?? "").split(",").filter((t): t is CalendarEventType => (TYPES as string[]).includes(t));
  const viewsAll = can(user.role, "calendar:view:all");
  const mine = viewsAll ? sp.mine === "1" : true;

  const days = daysFor(view, anchor, env.weekStart);
  const { from, to } = utcRange(days, tz);
  const events = await listCalendarEvents(user, { from, to, types: active, mine });

  const href = (o: Partial<{ view: string; date: string; types: string[]; mine: boolean }>) => {
    const p = new URLSearchParams();
    p.set("view", o.view ?? view); p.set("date", o.date ?? anchor);
    const t = o.types ?? active; if (t.length) p.set("types", t.join(","));
    if ((o.mine ?? mine) && viewsAll) p.set("mine", "1");
    return `/calendar?${p}`;
  };
  const step = view === "month" ? { prev: addMonths(anchor, -1), next: addMonths(anchor, 1) } : view === "week" ? { prev: addDays(anchor, -7), next: addDays(anchor, 7) } : { prev: addDays(anchor, -1), next: addDays(anchor, 1) };
  const fmt = (o: Intl.DateTimeFormatOptions, k = anchor) => new Date(`${k}T00:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
  const title = view === "month" ? fmt({ month: "long", year: "numeric" }) : view === "week" ? `${fmt({ day: "numeric", month: "short" }, days[0])} – ${fmt({ day: "numeric", month: "short", year: "numeric" }, days[6])}` : fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const toggle = (t: CalendarEventType) => active.includes(t) ? active.filter((x) => x !== t) : [...active, t];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <div className="flex gap-1 rounded-md border bg-white p-1 text-sm">
          {(["month", "week", "day"] as const).map((v) => <Link key={v} href={href({ view: v })} className={`rounded px-3 py-1 capitalize ${v === view ? "bg-brand-600 text-white" : "hover:bg-slate-100"}`}>{v}</Link>)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href({ date: step.prev })} className="btn-secondary !px-3" aria-label="Previous">‹</Link>
        <Link href={href({ date: today })} className="btn-secondary">Today</Link>
        <Link href={href({ date: step.next })} className="btn-secondary !px-3" aria-label="Next">›</Link>
        <h2 className="ml-2 text-lg font-medium">{title}</h2>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {TYPES.map((t) => (
          <Link key={t} href={href({ types: toggle(t) })} className={`rounded-full border px-3 py-1 ${EVENT_COLORS[t].cls} ${active.length && !active.includes(t) ? "opacity-40" : ""}`}>{EVENT_COLORS[t].label}</Link>
        ))}
        {active.length > 0 && <Link href={href({ types: [] })} className="text-slate-500 underline">All types</Link>}
        {viewsAll && <Link href={href({ mine: !mine })} className={`ml-auto rounded-full border px-3 py-1 ${mine ? "bg-slate-800 text-white" : "bg-white"}`}>{mine ? "Showing: mine only" : "Showing: everyone"}</Link>}
      </div>
      {view === "month"
        ? <MonthView days={days} anchor={anchor} today={today} events={events} tz={tz} weekStart={env.weekStart} hrefFor={(k) => href({ view: "day", date: k })} />
        : <TimeGrid days={days} today={today} events={events} tz={tz} hrefFor={(k) => href({ view: "day", date: k })} />}
      <p className="text-xs text-slate-400">Times are in {tz}. Events are generated automatically from each task&apos;s shooting, deadline and publishing dates.</p>
    </div>
  );
}
