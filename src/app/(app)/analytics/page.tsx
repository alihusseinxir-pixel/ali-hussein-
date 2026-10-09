import Link from "next/link";
import { requireUser } from "@/lib/session";
import { RANGES, loadAnalytics, parseRange, type PersonRow } from "@/lib/analytics";
import { formatDuration } from "@/lib/analytics-calc";
import { AR_ROLE as ROLE_LABELS } from "@/lib/i18n/ar";
import { VolumeChart } from "@/components/charts/VolumeChart";
import { TypeBars } from "@/components/charts/TypeBars";

const pct = (n: number | null) => (n === null ? "—" : `${n}%`);

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" }) {
  return (
    <div className="card !p-4">
      <div className="text-xs text-[color:var(--text-secondary)]">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === "bad" ? "text-red-600" : ""}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[color:var(--text-muted)]">{sub}</div>}
    </div>
  );
}

function PersonTiles({ me }: { me: PersonRow }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Tile label="المُسلَّم" value={String(me.delivered)} sub="سُلِّم للمرحلة التالية" />
      <Tile label="متوسط التسليم" value={formatDuration(me.avgDeliveryHours)} sub="من الاستلام إلى التسليم" />
      <Tile label="مفتوحة الآن" value={String(me.open)} />
      <Tile label="متأخرة الآن" value={String(me.overdue)} tone={me.overdue ? "bad" : undefined} />
      <Tile label="نسبة التعديلات" value={pct(me.revisionRate)} sub={`${me.revisionsReceived} أُعيدت`} />
      {me.approvalsGiven > 0 && <Tile label="الموافقات المُعطاة" value={String(me.approvalsGiven)} sub={`المتوسط ${formatDuration(me.avgApprovalHours)}`} />}
    </div>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const key = parseRange((await searchParams).range);
  const a = await loadAnalytics(user, key);

  const filter = (
    <nav className="flex gap-1 rounded-md border bg-white p-1 text-sm" aria-label="الفترة الزمنية">
      {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((k) => (
        <Link key={k} href={`/analytics?range=${k}`} aria-current={k === key ? "true" : undefined} className={`rounded px-3 py-1 ${k === key ? "bg-brand-600 text-white" : "hover:bg-slate-100"}`}>{RANGES[k].label}</Link>
      ))}
    </nav>
  );

  if (a.scope === "self") {
    return (
      <div className="viz-root space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">أدائي</h1>{filter}</div>
        <PersonTiles me={a.me} />
        <p className="text-xs text-slate-400">هذه الأرقام تظهر لك وللمديرين فقط. المفتوحة والمتأخرة لقطة لليوم، وبقية الأرقام تغطي {RANGES[key].phrase}.</p>
      </div>
    );
  }

  const o = a.overview;
  const scope = RANGES[key].phrase;
  return (
    <div className="viz-root space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">التحليلات</h1>{filter}</div>

      <section aria-label="الأرقام الرئيسية" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <Tile label="المُنشأة" value={String(o.created)} sub={RANGES[key].label} />
        <Tile label="المنشورة" value={String(o.completed)} sub={RANGES[key].label} />
        <Tile label="مفتوحة الآن" value={String(o.open)} />
        <Tile label="متأخرة الآن" value={String(o.overdue)} tone={o.overdue ? "bad" : undefined} />
        <Tile label="زمن النشر" value={o.avgDaysToPublish === null ? "—" : `${o.avgDaysToPublish} ي`} sub="من الإنشاء إلى النشر" />
        <Tile label="زمن الموافقة" value={formatDuration(o.avgApprovalHours)} sub="من الوصول للمرحلة إلى القرار" />
        <Tile label="نسبة التعديلات" value={pct(o.revisionRate)} sub={`${o.revised} من ${o.reviewed} تمت مراجعتها`} />
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="card lg:col-span-3">
          <h2 className="font-medium">حجم الإنتاج</h2>
          <p className="mb-3 text-xs text-slate-500">المهام المُنشأة والمنشورة لكل {a.granularity === "month" ? "شهر" : "أسبوع"}</p>
          <VolumeChart data={a.series} />
        </section>
        <section className="card lg:col-span-2">
          <h2 className="font-medium">المحتوى حسب النوع</h2>
          <p className="mb-3 text-xs text-slate-500">المُنشأ في {scope}</p>
          <TypeBars rows={a.byType} />
        </section>
      </div>

      <section className="card overflow-x-auto !p-0">
        <div className="border-b px-4 py-3"><h2 className="font-medium">أداء الفريق</h2><p className="text-xs text-slate-500">التسليمات والموافقات في {scope}؛ المفتوحة والمتأخرة لقطة لليوم.</p></div>
        <table className="w-full text-start text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr><th className="p-3 text-start">الشخص</th><th className="p-3 text-end">مفتوحة</th><th className="p-3 text-end">متأخرة</th><th className="p-3 text-end">مُسلَّمة</th><th className="p-3 text-end">متوسط التسليم</th><th className="p-3 text-end">أُعيدت</th><th className="p-3 text-end">الموافقات</th></tr>
          </thead>
          <tbody className="divide-y">
            {a.people.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">لا يوجد نشاط للفريق بعد.</td></tr>}
            {a.people.map((p) => (
              <tr key={p.userId}>
                <td className="p-3"><div className="font-medium">{p.name}</div><div className="text-xs text-slate-400">{ROLE_LABELS[p.role]}</div></td>
                <td className="p-3 text-end tabular-nums">{p.open}</td>
                <td className={`p-3 text-end tabular-nums ${p.overdue ? "font-medium text-red-600" : ""}`}>{p.overdue}</td>
                <td className="p-3 text-end tabular-nums">{p.delivered}</td>
                <td className="p-3 text-end tabular-nums">{formatDuration(p.avgDeliveryHours)}</td>
                <td className="p-3 text-end tabular-nums">{p.revisionsReceived}{p.revisionRate !== null && <span className="text-xs text-slate-400"> ({p.revisionRate}%)</span>}</td>
                <td className="p-3 text-end tabular-nums">{p.approvalsGiven > 0 ? <>{p.approvalsGiven}<span className="text-xs text-slate-400"> · {formatDuration(p.avgApprovalHours)}</span></> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card overflow-x-auto !p-0">
        <div className="border-b px-4 py-3"><h2 className="font-medium">أداء الحملات</h2><p className="text-xs text-slate-500">أرقام كل الفترة لكل حملة.</p></div>
        <table className="w-full text-start text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr><th className="p-3 text-start">الحملة</th><th className="p-3 text-start">التقدم</th><th className="p-3 text-end">المحتوى</th><th className="p-3 text-end">متأخرة</th><th className="p-3 text-end">زمن النشر</th><th className="p-3 text-end">نسبة التعديلات</th></tr>
          </thead>
          <tbody className="divide-y">
            {a.campaigns.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">لا يوجد محتوى حملات بعد.</td></tr>}
            {a.campaigns.map((c) => (
              <tr key={c.campaignId}>
                <td className="p-3"><Link href={`/campaigns/${c.campaignId}`} className="font-medium hover:underline">{c.name}</Link><div className="text-xs text-slate-400">{c.brand}</div></td>
                <td className="w-48 p-3">
                  <div className="h-2 rounded-full" style={{ background: "var(--meter-track)" }} role="img" aria-label={`${c.percent}% منشور`}><div className="h-2 rounded-full" style={{ width: `${c.percent}%`, background: "var(--meter-fill)" }} /></div>
                  <div className="mt-1 text-xs text-slate-500">{c.published}/{c.total} · {c.percent}%</div>
                </td>
                <td className="p-3 text-end tabular-nums">{c.total}</td>
                <td className={`p-3 text-end tabular-nums ${c.overdue ? "font-medium text-red-600" : ""}`}>{c.overdue}</td>
                <td className="p-3 text-end tabular-nums">{c.avgDaysToPublish === null ? "—" : `${c.avgDaysToPublish} ي`}</td>
                <td className="p-3 text-end tabular-nums">{pct(c.revisionRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-slate-400">التعريفات: <b>التسليم</b> = استلم شخص مهمة وسلّمها للمرحلة التالية؛ <b>أُعيدت</b> = أعاد المراجع العمل إليه؛ <b>نسبة التعديلات</b> = المهام التي أُعيدت مرة على الأقل ÷ المهام التي وصلت للمراجعة؛ <b>زمن الموافقة</b> = من وصول المهمة للمراجع إلى قراره.</p>
    </div>
  );
}
