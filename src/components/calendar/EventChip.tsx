import Link from "next/link";
import { EVENT_COLORS, timeLabel } from "@/lib/calendar";
import type { CalEvent } from "./types";

export function EventChip({ e, tz, className = "" }: { e: CalEvent; tz: string; className?: string }) {
  const c = EVENT_COLORS[e.type];
  return (
    <Link
      href={`/tasks/${e.task.id}`}
      title={`${c.label} · ${e.task.taskCode}${e.userName ? ` · ${e.userName}` : ""}\n${e.title}`}
      className={`block overflow-hidden rounded border px-1.5 py-0.5 text-[11px] leading-tight hover:brightness-95 ${c.cls} ${className}`}
    >
      <span className="font-semibold">{timeLabel(e.startsAt, tz)}</span> {e.title}
    </Link>
  );
}
