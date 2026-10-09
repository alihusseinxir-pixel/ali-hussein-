import { BUCKETS, type CampaignSummary } from "@/lib/campaign-stats";
import { AR_BUCKET as BUCKET_LABELS } from "@/lib/i18n/ar";

const COLORS: Record<(typeof BUCKETS)[number], string> = {
  planning: "bg-slate-300", production: "bg-violet-400", editing: "bg-indigo-400", approval: "bg-amber-400", scheduled: "bg-teal-400", published: "bg-green-500",
};

export function ProgressBar({ s, legend }: { s: CampaignSummary; legend?: boolean }) {
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${s.percent}% منشور (${s.done} من ${s.total})`}>
        {BUCKETS.map((b) => s.buckets[b] > 0 && <div key={b} className={COLORS[b]} style={{ width: `${(s.buckets[b] / s.total) * 100}%` }} title={`${BUCKET_LABELS[b]}: ${s.buckets[b]}`} />)}
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{s.done} من {s.total} منشور ({s.percent}%)</span>
        {s.overdue > 0 && <span className="font-medium text-red-600">{s.overdue} متأخرة</span>}
      </div>
      {legend && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {BUCKETS.map((b) => <li key={b} className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${COLORS[b]}`} />{BUCKET_LABELS[b]} {s.buckets[b]}</li>)}
        </ul>
      )}
    </div>
  );
}
