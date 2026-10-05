"use client";
import { useState } from "react";

export interface VolumePoint { label: string; created: number; published: number }

const W = 640, H = 260, M = { l: 40, r: 8, t: 10, b: 30 };
const BAR_MAX = 24, GAP = 2, RADIUS = 4;

/** 1 / 2 / 5 × 10ⁿ ceiling, so axis ticks are clean numbers. */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].map((m) => m * p).find((c) => c >= v) ?? v);
}

/** Column with a 4px rounded data-end and a square baseline. */
function columnPath(x: number, w: number, top: number, base: number): string {
  const h = base - top;
  if (h <= 0) return "";
  const r = Math.min(RADIUS, h, w / 2);
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
}

export function VolumeChart({ data, createdLabel = "Created", publishedLabel = "Published", unit = "tasks" }: { data: VolumePoint[]; createdLabel?: string; publishedLabel?: string; unit?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...data.flatMap((d) => [d.created, d.published])));
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  const innerW = W - M.l - M.r, innerH = H - M.t - M.b;
  const band = innerW / Math.max(1, data.length);
  const y = (v: number) => M.t + innerH - (v / max) * innerH;
  const barW = Math.min(BAR_MAX, Math.max(4, (band - 6) / 2 - GAP / 2));
  const empty = data.every((d) => d.created === 0 && d.published === 0);
  const point = active === null ? null : data[active];
  const flip = active !== null && active > data.length / 2; // right half → tooltip sits to the left of the band
  const tipEdge = active === null ? 0 : (((M.l + band * (flip ? active : active + 1)) / W) * 100);

  if (empty) return <p className="rounded-md bg-slate-50 p-6 text-center text-sm text-slate-500">No activity in this period.</p>;

  return (
    <div>
      <ul className="mb-2 flex gap-4 text-xs text-[color:var(--text-secondary)]" aria-label="Legend">
        <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--series-1)" }} />{createdLabel}</li>
        <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--series-2)" }} />{publishedLabel}</li>
      </ul>
      <div className="relative" onPointerLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${createdLabel} and ${publishedLabel.toLowerCase()} ${unit} per period. A table view follows the chart.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
              <text x={M.l - 6} y={y(t) + 4} textAnchor="end" fontSize={12} fill="var(--text-muted)">{Math.round(t).toLocaleString("en-US")}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = M.l + band * i + band / 2;
            const x1 = cx - barW - GAP / 2, x2 = cx + GAP / 2;
            const dim = active !== null && active !== i;
            return (
              <g key={i} opacity={dim ? 0.45 : 1}>
                <path d={columnPath(x1, barW, y(d.created), y(0))} fill="var(--series-1)" />
                <path d={columnPath(x2, barW, y(d.published), y(0))} fill="var(--series-2)" />
                {(data.length <= 8 || i % Math.ceil(data.length / 7) === 0) && (
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--text-muted)">{d.label}</text>
                )}
                {/* Hit target: the whole band, far larger than the marks. Also keyboard-focusable. */}
                <rect x={M.l + band * i} y={M.t} width={band} height={innerH + M.b} fill="transparent" tabIndex={0}
                  aria-label={`${d.label}: ${d.created} ${createdLabel.toLowerCase()}, ${d.published} ${publishedLabel.toLowerCase()}`}
                  onPointerEnter={() => setActive(i)} onPointerMove={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} />
              </g>
            );
          })}
        </svg>
        {point && (
          <div role="status" className="pointer-events-none absolute top-2 z-10 whitespace-nowrap rounded-md border bg-white px-3 py-2 text-xs shadow-md" style={{ left: `${tipEdge}%`, transform: flip ? "translateX(calc(-100% - 6px))" : "translateX(6px)" }}>
            <div className="mb-1 text-[color:var(--text-secondary)]">{point.label}</div>
            {[[createdLabel, point.created, "var(--series-1)"], [publishedLabel, point.published, "var(--series-2)"]].map(([name, v, c]) => (
              <div key={name as string} className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-3" style={{ background: c as string }} />
                <b className="text-sm text-[color:var(--text-primary)]">{v as number}</b><span className="text-[color:var(--text-secondary)]">{name as string}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-brand-600">View as table</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-slate-500"><tr><th className="py-1">Period</th><th>{createdLabel}</th><th>{publishedLabel}</th></tr></thead>
          <tbody className="divide-y">{data.map((d, i) => <tr key={i}><td className="py-1">{d.label}</td><td className="tabular-nums">{d.created}</td><td className="tabular-nums">{d.published}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
