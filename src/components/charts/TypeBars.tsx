import { AR_CONTENT_TYPE } from "@/lib/i18n/ar";
const pretty = (s: string) => AR_CONTENT_TYPE[s] ?? s;

/** Horizontal bars, one series (single hue, no legend needed): value at the tip, table-like and keyboard-safe. */
export function TypeBars({ rows }: { rows: { type: string; created: number; published: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.created));
  if (rows.length === 0) return <p className="rounded-md bg-slate-50 p-6 text-center text-sm text-slate-500">لم يُنشأ محتوى في هذه الفترة.</p>;
  return (
    <ul className="space-y-2.5" aria-label="المحتوى المُنشأ حسب النوع">
      {rows.map((r) => (
        <li key={r.type} className="grid grid-cols-[8.5rem_1fr] items-center gap-3 text-sm" title={`${pretty(r.type)}: ${r.created} مُنشأ، ${r.published} منشور`}>
          <span className="truncate text-[color:var(--text-secondary)]">{pretty(r.type)}</span>
          <div className="flex items-center gap-2">
            <div className="h-4 rounded-r-[4px]" style={{ width: `${(r.created / max) * 100}%`, minWidth: 4, background: "var(--series-1)" }} />
            <span className="font-semibold tabular-nums text-[color:var(--text-primary)]">{r.created}</span>
            {r.published > 0 && <span className="text-xs text-[color:var(--text-muted)]">{r.published} منشور</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
