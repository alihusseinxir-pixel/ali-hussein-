"use client";
import { useEffect, useRef } from "react";

/** Scroll container that opens at a given hour so daytime events are visible without scrolling. */
export function GridScroller({ hour, hourPx, children }: { hour: number; hourPx: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = Math.max(0, hour - 0.5) * hourPx; }, [hour, hourPx]);
  return <div ref={ref} className="max-h-[42rem] overflow-y-auto">{children}</div>;
}
