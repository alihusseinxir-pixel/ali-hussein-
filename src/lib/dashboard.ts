import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { env } from "./env";
import { can } from "./rbac";
import { addDays, dayKey, utcRange } from "./calendar";
import { visibleTasksWhere, type Actor } from "./tasks";
import { listShoots } from "./shoots";
import { shootBlockers, type Blocker } from "./blockers";
import { workStatusWhere } from "./work-status";

const CLOSED = ["PUBLISHED", "COMPLETED"] as const;
const person = { select: { id: true, name: true } } as const;

/** Everything the dashboard shows beyond the stage counters; every query is scoped to what the actor may see. */
export async function dashboardExtras(a: Actor) {
  const now = new Date(), tz = env.timezone;
  const today = dayKey(now, tz);
  const todayRange = utcRange([today], tz);
  const weekRange = utcRange([today, addDays(today, 6)], tz);
  const visible = visibleTasksWhere(a);
  const open: Prisma.TaskWhereInput = { stage: { notIn: [...CLOSED] } };
  const overdueWhere: Prisma.TaskWhereInput = { AND: [visible, open, { deadline: { lt: now } }] };
  const approvalWhere: Prisma.TaskWhereInput = { AND: [visible, { stage: { in: ["INTERNAL_APPROVAL", "SOCIAL_APPROVAL"] } }] };
  const publishWhere: Prisma.TaskWhereInput = { AND: [visible, open, { publishAt: { gte: now, lt: weekRange.to } }] };

  const [todayShoots, weekShoots, overdue, overdueTotal, approvals, approvalsTotal, publishing, changes, loadRows] = await Promise.all([
    listShoots(a, todayRange, { warnings: false }),
    listShoots(a, { from: now, to: weekRange.to }),
    db.task.findMany({ where: overdueWhere, orderBy: { deadline: "asc" }, take: 5, select: { id: true, taskCode: true, title: true, deadline: true, currentAssignee: person } }),
    db.task.count({ where: overdueWhere }),
    db.task.findMany({ where: approvalWhere, orderBy: { deadline: { sort: "asc", nulls: "last" } }, take: 5, select: { id: true, taskCode: true, title: true, stage: true, currentAssignee: person } }),
    db.task.count({ where: approvalWhere }),
    db.task.findMany({ where: publishWhere, orderBy: { publishAt: "asc" }, take: 6, select: { id: true, taskCode: true, title: true, publishAt: true, platform: true, stage: true } }),
    db.task.findMany({ where: { AND: [visible, workStatusWhere("CHANGES_REQUESTED")] }, orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, taskCode: true, title: true } }),
    can(a.role, "task:view:all")
      ? db.task.groupBy({ by: ["currentAssigneeId"], where: { AND: [visible, open, { currentAssigneeId: { not: null } }] }, _count: true })
      : Promise.resolve([]),
  ]);

  const blockers: Blocker[] = [
    ...changes.map((t): Blocker => ({ kind: "changes", message: `مطلوب تعديلات: ${t.title} (${t.taskCode})`, href: `/tasks/${t.id}` })),
    ...weekShoots.filter((s) => s.status === "PLANNED").flatMap((s) => shootBlockers({ id: s.id, title: s.title, startsAt: s.startsAt, warningCount: s.warnings.length, contents: s.contents }, now)),
  ];

  const ids = loadRows.flatMap((r) => (r.currentAssigneeId ? [r.currentAssigneeId] : []));
  const overdueByUser = ids.length
    ? await db.task.groupBy({ by: ["currentAssigneeId"], where: { AND: [visible, open, { deadline: { lt: now } }, { currentAssigneeId: { in: ids } }] }, _count: true })
    : [];
  const names = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const lateOf = new Map(overdueByUser.map((r) => [r.currentAssigneeId, r._count]));
  const workload = loadRows
    .map((r) => ({ id: r.currentAssigneeId as string, name: names.get(r.currentAssigneeId as string) ?? "—", open: r._count, overdue: lateOf.get(r.currentAssigneeId) ?? 0 }))
    .sort((x, y) => y.open - x.open);

  return {
    todayShoots: todayShoots.filter((s) => s.status !== "CANCELLED"),
    overdue, overdueTotal, approvals, approvalsTotal, publishing, blockers, workload,
  };
}
