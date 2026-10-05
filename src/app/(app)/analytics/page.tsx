import Link from "next/link";
import { requireUser } from "@/lib/session";
import { RANGES, loadAnalytics, parseRange, type PersonRow } from "@/lib/analytics";
import { formatDuration } from "@/lib/analytics-calc";
import { ROLE_LABELS } from "@/lib/rbac";
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
      <Tile label="Delivered" value={String(me.delivered)} sub="handed forward" />
      <Tile label="Average delivery" value={formatDuration(me.avgDeliveryHours)} sub="receipt → hand-over" />
      <Tile label="Open now" value={String(me.open)} />
      <Tile label="Overdue now" value={String(me.overdue)} tone={me.overdue ? "bad" : undefined} />
      <Tile label="Revision rate" value={pct(me.revisionRate)} sub={`${me.revisionsReceived} sent back`} />
      {me.approvalsGiven > 0 && <Tile label="Approvals given" value={String(me.approvalsGiven)} sub={`avg ${formatDuration(me.avgApprovalHours)}`} />}
    </div>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const key = parseRange((await searchParams).range);
  const a = await loadAnalytics(user, key);

  const filter = (
    <nav className="flex gap-1 rounded-md border bg-white p-1 text-sm" aria-label="Date range">
      {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((k) => (
        <Link key={k} href={`/analytics?range=${k}`} aria-current={k === key ? "true" : undefined} className={`rounded px-3 py-1 ${k === key ? "bg-brand-600 text-white" : "hover:bg-slate-100"}`}>{RANGES[k].label}</Link>
      ))}
    </nav>
  );

  if (a.scope === "self") {
    return (
      <div className="viz-root space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">My performance</h1>{filter}</div>
        <PersonTiles me={a.me} />
        <p className="text-xs text-slate-400">These numbers are visible only to you and to managers. Overdue and open are a snapshot of today; the rest cover {RANGES[key].phrase}.</p>
      </div>
    );
  }

  const o = a.overview;
  const scope = RANGES[key].phrase;
  return (
    <div className="viz-root space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Analytics</h1>{filter}</div>

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <Tile label="Created" value={String(o.created)} sub={RANGES[key].label} />
        <Tile label="Published" value={String(o.completed)} sub={RANGES[key].label} />
        <Tile label="Open now" value={String(o.open)} />
        <Tile label="Overdue now" value={String(o.overdue)} tone={o.overdue ? "bad" : undefined} />
        <Tile label="Time to publish" value={o.avgDaysToPublish === null ? "—" : `${o.avgDaysToPublish} d`} sub="created → published" />
        <Tile label="Approval time" value={formatDuration(o.avgApprovalHours)} sub="reach stage → decision" />
        <Tile label="Revision rate" value={pct(o.revisionRate)} sub={`${o.revised} of ${o.reviewed} reviewed`} />
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="card lg:col-span-3">
          <h2 className="font-medium">Production volume</h2>
          <p className="mb-3 text-xs text-slate-500">Tasks created and published per {a.granularity}</p>
          <VolumeChart data={a.series} />
        </section>
        <section className="card lg:col-span-2">
          <h2 className="font-medium">Content by type</h2>
          <p className="mb-3 text-xs text-slate-500">Created in {scope}</p>
          <TypeBars rows={a.byType} />
        </section>
      </div>

      <section className="card overflow-x-auto !p-0">
        <div className="border-b px-4 py-3"><h2 className="font-medium">Team performance</h2><p className="text-xs text-slate-500">Deliveries and approvals in {scope}; open and overdue are today&apos;s snapshot.</p></div>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th className="p-3">Person</th><th className="p-3 text-right">Open</th><th className="p-3 text-right">Overdue</th><th className="p-3 text-right">Delivered</th><th className="p-3 text-right">Avg delivery</th><th className="p-3 text-right">Sent back</th><th className="p-3 text-right">Approvals</th></tr>
          </thead>
          <tbody className="divide-y">
            {a.people.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">No team activity yet.</td></tr>}
            {a.people.map((p) => (
              <tr key={p.userId}>
                <td className="p-3"><div className="font-medium">{p.name}</div><div className="text-xs text-slate-400">{ROLE_LABELS[p.role]}</div></td>
                <td className="p-3 text-right tabular-nums">{p.open}</td>
                <td className={`p-3 text-right tabular-nums ${p.overdue ? "font-medium text-red-600" : ""}`}>{p.overdue}</td>
                <td className="p-3 text-right tabular-nums">{p.delivered}</td>
                <td className="p-3 text-right tabular-nums">{formatDuration(p.avgDeliveryHours)}</td>
                <td className="p-3 text-right tabular-nums">{p.revisionsReceived}{p.revisionRate !== null && <span className="text-xs text-slate-400"> ({p.revisionRate}%)</span>}</td>
                <td className="p-3 text-right tabular-nums">{p.approvalsGiven > 0 ? <>{p.approvalsGiven}<span className="text-xs text-slate-400"> · {formatDuration(p.avgApprovalHours)}</span></> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card overflow-x-auto !p-0">
        <div className="border-b px-4 py-3"><h2 className="font-medium">Campaign performance</h2><p className="text-xs text-slate-500">Lifetime figures per campaign.</p></div>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th className="p-3">Campaign</th><th className="p-3">Progress</th><th className="p-3 text-right">Content</th><th className="p-3 text-right">Overdue</th><th className="p-3 text-right">Time to publish</th><th className="p-3 text-right">Revision rate</th></tr>
          </thead>
          <tbody className="divide-y">
            {a.campaigns.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">No campaign content yet.</td></tr>}
            {a.campaigns.map((c) => (
              <tr key={c.campaignId}>
                <td className="p-3"><Link href={`/campaigns/${c.campaignId}`} className="font-medium hover:underline">{c.name}</Link><div className="text-xs text-slate-400">{c.brand}</div></td>
                <td className="w-48 p-3">
                  <div className="h-2 rounded-full" style={{ background: "var(--meter-track)" }} role="img" aria-label={`${c.percent}% published`}><div className="h-2 rounded-full" style={{ width: `${c.percent}%`, background: "var(--meter-fill)" }} /></div>
                  <div className="mt-1 text-xs text-slate-500">{c.published}/{c.total} · {c.percent}%</div>
                </td>
                <td className="p-3 text-right tabular-nums">{c.total}</td>
                <td className={`p-3 text-right tabular-nums ${c.overdue ? "font-medium text-red-600" : ""}`}>{c.overdue}</td>
                <td className="p-3 text-right tabular-nums">{c.avgDaysToPublish === null ? "—" : `${c.avgDaysToPublish} d`}</td>
                <td className="p-3 text-right tabular-nums">{pct(c.revisionRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-slate-400">Definitions: <b>delivery</b> = a person received a task and handed it forward; <b>sent back</b> = a reviewer returned work to them; <b>revision rate</b> = reviewed tasks sent back at least once ÷ tasks that reached review; <b>approval time</b> = from the task reaching a reviewer to their decision.</p>
    </div>
  );
}
