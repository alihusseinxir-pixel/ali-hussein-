import "server-only";
import type { CalendarEventType } from "@prisma/client";
import { db } from "./db";
import { can } from "./rbac";
import { visibleTasksWhere, type Actor } from "./tasks";

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
