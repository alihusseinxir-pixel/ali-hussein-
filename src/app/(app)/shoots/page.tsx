import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { env } from "@/lib/env";
import { listShoots } from "@/lib/shoots";
import { addDays, dayKey, daysFor, isDayKey, timeLabel, utcRange } from "@/lib/calendar";
import { AR_SHOOT_STATUS } from "@/lib/i18n/ar";

export default async function ShootsPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tz = env.timezone;
  const today = dayKey(new Date(), tz);
  const anchor = isDayKey(sp.week) ? sp.week : today;
  const days = daysFor("week", anchor, env.weekStart);
  const { from, to } = utcRange(days, tz);
  const shoots = await listShoots(user, { from, to });
  const manage = can(user.role, "shoot:manage");
  const fmt = new Intl.DateTimeFormat("ar", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">جلسات التصوير</h1>
        {manage && <div className="flex gap-2"><Link href="/shoots/resources" className="btn-secondary">المودلز واللوكيشنات</Link><Link href="/shoots/new" className="btn">+ جلسة جديدة</Link></div>}
      </div>
      <nav className="flex items-center gap-2 text-sm" aria-label="التنقل بين الأسابيع">
        <Link className="btn-secondary" href={`/shoots?week=${addDays(days[0], -7)}`}>الأسبوع السابق</Link>
        <Link className="btn-secondary" href="/shoots">هذا الأسبوع</Link>
        <Link className="btn-secondary" href={`/shoots?week=${addDays(days[0], 7)}`}>الأسبوع التالي</Link>
      </nav>
      <div className="space-y-4">
        {days.map((k) => {
          const list = shoots.filter((s) => dayKey(s.startsAt, tz) === k);
          return (
            <section key={k} className={`card ${k === today ? "border-brand-500" : ""}`}>
              <h2 className="mb-2 text-sm font-medium text-slate-500">{fmt.format(new Date(`${k}T00:00:00Z`))}{k === today && " · اليوم"}</h2>
              {list.length === 0 ? <p className="text-sm text-slate-400">لا توجد جلسات.</p> : (
                <ul className="divide-y">
                  {list.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div>
                        <Link href={`/shoots/${s.id}`} className={`font-medium hover:underline ${s.status === "CANCELLED" ? "text-slate-400 line-through" : ""}`}>{s.title}</Link>
                        <div className="text-xs text-slate-500">
                          <span dir="ltr">{timeLabel(s.startsAt, tz)}–{timeLabel(s.endsAt, tz)}</span>
                          {s.location && ` · ${s.location.name}`}
                          {[s.photographer, s.videographer].filter(Boolean).map((u) => ` · ${u!.name}`)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        {s.warnings.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">⚠ {s.warnings.length} تنبيه</span>}
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">{AR_SHOOT_STATUS[s.status]}</span>
                        <span className="text-slate-400">{s.checklist.filter((c) => c.done).length}/{s.checklist.length}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
