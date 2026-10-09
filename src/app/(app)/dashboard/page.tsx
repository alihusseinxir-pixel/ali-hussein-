import Link from "next/link";
import { requireUser } from "@/lib/session";
import { dashboardCounts, listTasks } from "@/lib/tasks";
import { can } from "@/lib/rbac";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/datetime";
import { listCalendarEvents } from "@/lib/calendar-query";
import { EVENT_COLORS, dayKey, daysFor, timeLabel, utcRange } from "@/lib/calendar";
import { PriorityBadge, StageBadge } from "@/components/Badges";
import { AR_EVENT, AR_STAGE } from "@/lib/i18n/ar";
import { dashboardExtras } from "@/lib/dashboard";
import { timeLabel as tl } from "@/lib/calendar";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const { denied } = await searchParams;
  const c = await dashboardCounts(user);
  const mine = await listTasks(user, { mine: true, sort: "deadline" });
  const x = await dashboardExtras(user);
  const tz = env.timezone;
  const todayKey = dayKey(new Date(), env.timezone);
  const { from, to } = utcRange(daysFor("day", todayKey), env.timezone);
  const today = await listCalendarEvents(user, { from, to, mine: true });
  const scope = can(user.role, "task:view:all") ? "" : " (مهامك فقط)";
  const tiles: [string, number, string?][] = [
    ["إجمالي المهام", c.total], ["قيد التصوير", c.inProduction], ["مونتاج / تصميم", c.editing],
    ["بانتظار المراجعة", c.waitingReview], ["بانتظار الموافقة", c.waitingApproval], ["مجدولة", c.scheduled],
    ["منشورة", c.published], ["مكتملة", c.completed], ["متأخرة", c.overdue, c.overdue ? "text-red-600" : ""],
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">أهلاً، {user.name.split(" ")[0]}</h1>
      {denied && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">ليست لديك صلاحية للوصول إلى تلك الصفحة.</p>}
      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-500">نظرة عامة{scope}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map(([label, n, cls]) => (
            <div key={label} className="card !p-4"><div className={`text-2xl font-semibold ${cls ?? ""}`}>{n}</div><div className="text-xs text-slate-500">{label}</div></div>
          ))}
        </div>
      </section>
      {x.blockers.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4" aria-label="العوائق">
          <h2 className="mb-2 font-medium text-amber-900">العوائق ({x.blockers.length})</h2>
          <ul className="list-disc space-y-1 ps-5 text-sm text-amber-900">
            {x.blockers.slice(0, 8).map((b, i) => <li key={i}><Link className="hover:underline" href={b.href}>{b.message}</Link></li>)}
          </ul>
        </section>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-medium">جلسات تصوير اليوم</h2>
          {x.todayShoots.length === 0 ? <p className="text-sm text-slate-500">لا توجد جلسات تصوير اليوم.</p> : (
            <ul className="divide-y text-sm">
              {x.todayShoots.map((sh) => (
                <li key={sh.id} className="py-2"><span className="font-semibold" dir="ltr">{tl(sh.startsAt, tz)}</span> · <Link href={`/shoots/${sh.id}`} className="hover:underline">{sh.title}</Link>{sh.location && <span className="text-slate-500"> · {sh.location.name}</span>}</li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">مهام متأخرة <span className={x.overdueTotal ? "text-red-600" : "text-slate-400"}>({x.overdueTotal})</span></h2><Link className="text-sm text-brand-600 underline" href="/tasks?due=overdue">عرض الكل</Link></div>
          {x.overdue.length === 0 ? <p className="text-sm text-slate-500">لا توجد مهام متأخرة.</p> : (
            <ul className="divide-y text-sm">
              {x.overdue.map((t) => (
                <li key={t.id} className="py-2"><Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link>
                  <div className="text-xs text-red-600">الموعد: <bdi dir="ltr">{formatDateTime(t.deadline, tz)}</bdi>{t.currentAssignee && ` · ${t.currentAssignee.name}`}</div></li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">بانتظار الموافقة <span className="text-slate-400">({x.approvalsTotal})</span></h2>{can(user.role, "approval:internal") && <Link className="text-sm text-brand-600 underline" href="/approvals">فتح الموافقات</Link>}</div>
          {x.approvals.length === 0 ? <p className="text-sm text-slate-500">لا توجد موافقات معلّقة.</p> : (
            <ul className="divide-y text-sm">
              {x.approvals.map((t) => <li key={t.id} className="py-2"><Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link><div className="text-xs text-slate-500">{AR_STAGE[t.stage]}</div></li>)}
            </ul>
          )}
        </section>
        <section className="card">
          <h2 className="mb-3 font-medium">مواعيد النشر خلال 7 أيام</h2>
          {x.publishing.length === 0 ? <p className="text-sm text-slate-500">لا توجد مواعيد نشر قريبة.</p> : (
            <ul className="divide-y text-sm">
              {x.publishing.map((t) => <li key={t.id} className="py-2"><Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link><div className="text-xs text-slate-500"><bdi dir="ltr">{formatDateTime(t.publishAt, tz)}</bdi> · {AR_STAGE[t.stage]}</div></li>)}
            </ul>
          )}
        </section>
      </div>
      {x.workload.length > 0 && (
        <section className="card">
          <h2 className="mb-3 font-medium">عبء العمل على الفريق</h2>
          <ul className="space-y-2 text-sm">
            {x.workload.map((w) => (
              <li key={w.id} className="flex items-center gap-3">
                <span className="w-40 truncate">{w.name}</span>
                <div className="h-2 flex-1 rounded bg-slate-100" aria-hidden="true"><div className="h-2 rounded bg-brand-500" style={{ width: `${Math.min(100, (w.open / Math.max(...x.workload.map((v) => v.open))) * 100)}%` }} /></div>
                <span className="w-24 text-end">{w.open} مفتوحة{w.overdue > 0 && <span className="text-red-600"> · {w.overdue} متأخرة</span>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">اليوم</h2><Link className="text-sm text-brand-600 underline" href="/calendar?view=day">فتح التقويم</Link></div>
        {today.length === 0 ? <p className="text-sm text-slate-500">لا يوجد شيء مجدول لك اليوم.</p> : (
          <ul className="divide-y">
            {today.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-12 font-semibold">{timeLabel(e.startsAt, env.timezone)}</span>
                <span className={`rounded border px-1.5 py-0.5 text-xs ${EVENT_COLORS[e.type].cls}`}>{AR_EVENT[e.type]}</span>
                <Link href={`/tasks/${e.task.id}`} className="hover:underline">{e.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">مهامي</h2><Link className="text-sm text-brand-600 underline" href="/tasks?mine=1">عرض الكل</Link></div>
        {mine.items.length === 0 ? <p className="text-sm text-slate-500">لا توجد مهام مسندة إليك حالياً.</p> : (
          <ul className="divide-y">
            {mine.items.slice(0, 6).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div><Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link><div className="text-xs text-slate-400">{t.taskCode} · الموعد: {formatDateTime(t.deadline, env.timezone)}</div></div>
                <div className="flex gap-2"><PriorityBadge p={t.priority} /><StageBadge s={t.stage} /></div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
