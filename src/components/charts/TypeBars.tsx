const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Horizontal bars, one series (single hue, no legend needed): value at the tip, table-like and keyboard-safe. */
export function TypeBars({ rows }: { rows: { type: string; created: number; published: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.created));
  if (rows.length === 0) return <p className="rounded-md bg-slate-50 p-6 text-center text-sm text-slate-500">No content created in this period.</p>;
  return (
    <ul className="space-y-2.5" aria-label="Content created by type">
      {rows.map((r) => (
        <li key={r.type} className="grid grid-cols-[8.5rem_1fr] items-center gap-3 text-sm" title={`${pretty(r.type)}: ${r.created} created, ${r.published} published`}>
          <span className="truncate text-[color:var(--text-secondary)]">{pretty(r.type)}</span>
          <div className="flex items-center gap-2">
            <div className="h-4 rounded-r-[4px]" style={{ width: `${(r.created / max) * 100}%`, minWidth: 4, background: "var(--series-1)" }} />
            <span className="font-semibold tabular-nums text-[color:var(--text-primary)]">{r.created}</span>
            {r.published > 0 && <span className="text-xs text-[color:var(--text-muted)]">{r.published} published</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
