import "server-only";
import type { CalendarEventType } from "@prisma/client";
import { db } from "./db";
import { can } from "./rbac";
import { visibleTasksWhere, type Actor } from "./tasks";
import { listShoots } from "./shoots";
import type { CalEvent } from "@/components/calendar/types";

export interface CalendarQuery { from: Date; to: Date; types?: CalendarEventType[]; mine?: boolean }

/** Events visible to the actor: everything they may see (managers) or only events assigned to them. */
export async function listCalendarEvents(actor: Actor, q: CalendarQuery) {
  const personal = q.mine || !can(actor.role, "calendar:view:all");
  const rows = await db.calendarEvent.findMany({
    where: {
      organizationId: actor.organizationId,
      startsAt: { gte: q.from, lt: q.to },
      ...(q.types?.length && { type: { in: q.types } }),
      ...(personal && { userId: actor.id }),
      task: visibleTasksWhere(actor),
    },
    include: { task: { select: { id: true, taskCode: true } } },
    orderBy: { startsAt: "asc" },
  });
  const ids = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
  const names = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.flatMap((r) => r.task ? [{ id: r.id, type: r.type, title: r.title, startsAt: r.startsAt, endsAt: r.endsAt, task: r.task, userName: r.userId ? names.get(r.userId) ?? null : null }] : []);
}

/** Task dates plus shoot sessions, as one list for the calendar and dashboard. */
export async function listCalendarItems(actor: Actor, q: CalendarQuery): Promise<CalEvent[]> {
  const items: CalEvent[] = (await listCalendarEvents(actor, q)).map((e) => ({
    id: e.id, type: e.type, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, href: `/tasks/${e.task.id}`, ref: e.task.taskCode, userName: e.userName,
  }));
  if (!q.types?.length || q.types.includes("SHOOTING")) {
    const personal = q.mine || !can(actor.role, "calendar:view:all");
    for (const s of await listShoots(actor, { from: q.from, to: q.to }, { warnings: false })) {
      if (s.status === "CANCELLED") continue;
      const crew = [s.photographer, s.videographer, s.director].filter((u): u is { id: string; name: string } => !!u);
      if (personal && !crew.some((u) => u.id === actor.id)) continue;
      items.push({ id: `shoot:${s.id}`, type: "SHOOTING", title: `جلسة تصوير – ${s.title}`, startsAt: s.startsAt, endsAt: s.endsAt, href: `/shoots/${s.id}`, ref: "جلسة تصوير", userName: crew.map((u) => u.name).join("، ") || null });
    }
  }
  return items.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
