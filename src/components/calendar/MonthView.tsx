import Link from "next/link";
import { dayKey } from "@/lib/calendar";
import { EventChip } from "./EventChip";
import type { CalEvent } from "./types";

const MAX = 3;

export function MonthView({ days, anchor, today, events, tz, hrefFor, weekStart }: {
  days: string[]; anchor: string; today: string; events: CalEvent[]; tz: string; weekStart: number; hrefFor: (day: string) => string;
}) {
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) { const k = dayKey(e.startsAt, tz); byDay.set(k, [...(byDay.get(k) ?? []), e]); }
  const names = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 9, 4 + ((i + weekStart) % 7))).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }));
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[44rem] grid-cols-7 border-l border-t bg-white text-sm">
        {names.map((n) => <div key={n} className="border-b border-r bg-slate-50 p-2 text-center text-xs font-medium uppercase text-slate-500">{n}</div>)}
        {days.map((k) => {
          const list = byDay.get(k) ?? [];
          const inMonth = k.slice(0, 7) === anchor.slice(0, 7);
          return (
            <div key={k} className={`min-h-28 border-b border-r p-1.5 ${inMonth ? "" : "bg-slate-50/70 text-slate-400"}`}>
              <Link href={hrefFor(k)} className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${k === today ? "bg-brand-600 font-semibold text-white" : "hover:bg-slate-100"}`}>{Number(k.slice(8))}</Link>
              <div className="space-y-1">
                {list.slice(0, MAX).map((e) => <EventChip key={e.id} e={e} tz={tz} />)}
                {list.length > MAX && <Link href={hrefFor(k)} className="block text-[11px] text-brand-600 underline">+{list.length - MAX} more</Link>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
