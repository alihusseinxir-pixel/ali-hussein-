import type { CalendarEventType, ContentType, Role, TaskStage } from "@prisma/client";
import { parseLocalDateTime, toLocalInput } from "./datetime";
import { STAGE_LABELS } from "./workflow";

// ───────── Deriving events from a task (pure) ─────────

export interface EventDraft { type: CalendarEventType; title: string; startsAt: Date; endsAt: Date | null; userId: string | null }

interface TaskLike {
  title: string; contentType: ContentType; stage: TaskStage; deadline: Date | null; shootingAt: Date | null; publishAt: Date | null;
  currentAssigneeId: string | null;
}
interface Ctx { owner: { id: string; role: Role } | null; production: { id: string; role: Role } | null }

const DESIGN_ONLY: ContentType[] = ["STATIC_POST", "CAROUSEL", "STORY"];
const HOUR = 3600_000;

/** Every date on a task becomes a calendar event. The calendar is always a pure function of task state. */
export function eventsForTask(t: TaskLike, ctx: Ctx): EventDraft[] {
  const out: EventDraft[] = [];
  const photo = t.contentType === "PRODUCT_PHOTOGRAPHY" || ctx.production?.role === "PHOTOGRAPHER";
  const shootType: CalendarEventType = photo ? "PHOTOGRAPHY" : "SHOOTING";
  const designType: CalendarEventType = DESIGN_ONLY.includes(t.contentType) || ctx.owner?.role === "DESIGNER" ? "DESIGN" : "EDITING";

  if (t.shootingAt) {
    out.push({ type: shootType, title: `${photo ? "Photo shoot" : "Shooting"} – ${t.title}`, startsAt: t.shootingAt, endsAt: new Date(t.shootingAt.getTime() + 2 * HOUR), userId: ctx.production?.id ?? null });
  }
  if (t.publishAt) {
    out.push({ type: "PUBLISHING", title: `Publish – ${t.title}`, startsAt: t.publishAt, endsAt: null, userId: t.stage === "PUBLISHED" || t.stage === "COMPLETED" ? null : t.currentAssigneeId });
  }
  if (t.deadline && !["SCHEDULED", "PUBLISHED", "COMPLETED"].includes(t.stage)) {
    const type: CalendarEventType =
      t.stage === "EDITING" ? designType
      : ["PRODUCTION_REVIEW", "EDITING_REVIEW", "INTERNAL_APPROVAL", "SOCIAL_APPROVAL"].includes(t.stage) ? "REVIEW"
      : DESIGN_ONLY.includes(t.contentType) ? "DESIGN" : shootType;
    out.push({ type, title: `Due: ${STAGE_LABELS[t.stage]} – ${t.title}`, startsAt: t.deadline, endsAt: null, userId: t.currentAssigneeId });
  }
  return out;
}

// ───────── Date math in the organization's timezone ─────────

export type CalendarView = "month" | "week" | "day";
export const EVENT_COLORS: Record<CalendarEventType, { label: string; cls: string }> = {
  SHOOTING: { label: "Shooting", cls: "bg-violet-100 text-violet-800 border-violet-300" },
  PHOTOGRAPHY: { label: "Photography", cls: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300" },
  EDITING: { label: "Editing", cls: "bg-indigo-100 text-indigo-800 border-indigo-300" },
  DESIGN: { label: "Design", cls: "bg-sky-100 text-sky-800 border-sky-300" },
  REVIEW: { label: "Review", cls: "bg-amber-100 text-amber-800 border-amber-300" },
  PUBLISHING: { label: "Publishing", cls: "bg-green-100 text-green-800 border-green-300" },
};

export const isDayKey = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const dayKey = (d: Date, tz: string) => toLocalInput(d, tz).slice(0, 10);
export const minutesOfDay = (d: Date, tz: string) => { const t = toLocalInput(d, tz); return Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16)); };
export const timeLabel = (d: Date, tz: string) => toLocalInput(d, tz).slice(11, 16);

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const weekday = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay(); // 0 = Sunday

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

/** Day keys displayed for a view (month view includes leading/trailing days to fill whole weeks). */
export function daysFor(view: CalendarView, anchor: string, weekStart = 0): string[] {
  if (view === "day") return [anchor];
  const startOfWeek = (k: string) => addDays(k, -((weekday(k) - weekStart + 7) % 7));
  if (view === "week") { const s = startOfWeek(anchor); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
  const first = `${anchor.slice(0, 7)}-01`;
  const start = startOfWeek(first);
  const last = addDays(addMonths(first, 1), -1);
  const end = addDays(startOfWeek(last), 6);
  const days: string[] = [];
  for (let k = start; k <= end; k = addDays(k, 1)) days.push(k);
  return days;
}

/** UTC range [from, to) covering the given day keys in the timezone. */
export function utcRange(days: string[], tz: string): { from: Date; to: Date } {
  return { from: parseLocalDateTime(days[0], tz)!, to: parseLocalDateTime(addDays(days[days.length - 1], 1), tz)! };
}

/** Side-by-side lanes for overlapping events in a time grid. */
export function layoutLanes<T extends { start: number; end: number }>(items: T[]): (T & { lane: number; lanes: number })[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: (T & { lane: number; lanes: number })[] = [];
  let cluster: (T & { lane: number; lanes: number })[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];
  const flush = () => { cluster.forEach((c) => (c.lanes = laneEnds.length)); out.push(...cluster); cluster = []; laneEnds.length = 0; };
  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= it.start);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(it.end); } else laneEnds[lane] = it.end;
    cluster.push({ ...it, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}
