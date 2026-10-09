import { AR_EVENT } from "@/lib/i18n/ar";
import Link from "next/link";
import { EVENT_COLORS, dayKey, layoutLanes, minutesOfDay, timeLabel } from "@/lib/calendar";
import { GridScroller } from "./GridScroller";
import type { CalEvent } from "./types";

const HOUR_PX = 48;

export function TimeGrid({ days, today, events, tz, hrefFor }: { days: string[]; today: string; events: CalEvent[]; tz: string; hrefFor: (day: string) => string }) {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) { const k = dayKey(e.startsAt, tz); byDay.set(k, [...(byDay.get(k) ?? []), e]); }
  const firstHour = events.length ? Math.floor(Math.min(...events.map((e) => minutesOfDay(e.startsAt, tz))) / 60) : 8;
  const cols = `3.5rem repeat(${days.length}, minmax(${days.length > 1 ? "7rem" : "12rem"}, 1fr))`;
  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <GridScroller hour={firstHour} hourPx={HOUR_PX}>
        <div className="grid text-xs" style={{ gridTemplateColumns: cols }}>
          <div className="sticky top-0 z-20 border-b bg-slate-50" />
          {days.map((k) => (
            <Link key={k} href={hrefFor(k)} className={`sticky top-0 z-20 border-b border-l bg-slate-50 p-2 text-center font-medium hover:bg-slate-100 ${k === today ? "text-brand-700" : "text-slate-600"}`}>
              {new Date(`${k}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
            </Link>
          ))}
          <div>{hours.map((h) => <div key={h} className="border-b pe-1 text-end text-[10px] text-slate-400" style={{ height: HOUR_PX }}>{String(h).padStart(2, "0")}:00</div>)}</div>
          {days.map((k) => {
            const items = layoutLanes((byDay.get(k) ?? []).map((e) => {
              const start = minutesOfDay(e.startsAt, tz);
              const len = e.endsAt ? Math.max(30, Math.round((e.endsAt.getTime() - e.startsAt.getTime()) / 60000)) : 45;
              return { e, start, end: Math.min(1440, start + len) };
            }));
            return (
              <div key={k} className={`relative border-l ${k === today ? "bg-brand-50/40" : ""}`} style={{ height: HOUR_PX * 24 }}>
                {hours.map((h) => <div key={h} className="border-b" style={{ height: HOUR_PX }} />)}
                {items.map(({ e, start, end, lane, lanes }) => (
                  <Link
                    key={e.id} href={e.href}
                    title={`${AR_EVENT[e.type]} · ${e.ref}${e.userName ? ` · ${e.userName}` : ""}\n${e.title}`}
                    className={`absolute overflow-hidden rounded border px-1 py-0.5 text-[11px] leading-tight hover:z-10 hover:brightness-95 ${EVENT_COLORS[e.type].cls}`}
                    style={{ top: (start / 60) * HOUR_PX, height: Math.max(22, ((end - start) / 60) * HOUR_PX - 2), left: `${(lane / lanes) * 100}%`, width: `calc(${100 / lanes}% - 2px)` }}
                  >
                    <b>{timeLabel(e.startsAt, tz)}</b> {e.title}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      </GridScroller>
    </div>
  );
}
