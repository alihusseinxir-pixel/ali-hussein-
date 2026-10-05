import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { eventsForTask } from "./calendar";

/** Rebuild a task's calendar events from its current state. Call inside the same transaction as the change. */
export async function syncTaskCalendar(tx: Prisma.TransactionClient, taskId: string) {
  await tx.calendarEvent.deleteMany({ where: { taskId } });
  const task = await tx.task.findUnique({
    where: { id: taskId },
    include: {
      currentAssignee: { select: { id: true, role: true } },
      assignments: { where: { stage: { in: ["ASSIGNED", "PRODUCTION"] } }, orderBy: { assignedAt: "desc" }, take: 1, include: { user: { select: { id: true, role: true } } } },
    },
  });
  if (!task || task.deletedAt) return;
  const drafts = eventsForTask(task, { owner: task.currentAssignee, production: task.assignments[0]?.user ?? null });
  if (drafts.length === 0) return;
  await tx.calendarEvent.createMany({ data: drafts.map((e) => ({ ...e, organizationId: task.organizationId, taskId })) });
}

export async function clearTaskCalendar(taskId: string) {
  await db.calendarEvent.deleteMany({ where: { taskId } });
}
