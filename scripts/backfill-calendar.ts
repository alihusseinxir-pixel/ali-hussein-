// Rebuild calendar events for every task (run once after upgrading to Phase 6).
import { PrismaClient } from "@prisma/client";
import { eventsForTask } from "../src/lib/calendar";

const db = new PrismaClient();
async function main() {
  const tasks = await db.task.findMany({
    where: { deletedAt: null },
    include: {
      currentAssignee: { select: { id: true, role: true } },
      assignments: { where: { stage: { in: ["ASSIGNED", "PRODUCTION"] } }, orderBy: { assignedAt: "desc" }, take: 1, include: { user: { select: { id: true, role: true } } } },
    },
  });
  for (const t of tasks) {
    await db.$transaction([
      db.calendarEvent.deleteMany({ where: { taskId: t.id } }),
      db.calendarEvent.createMany({
        data: eventsForTask(t, { owner: t.currentAssignee, production: t.assignments[0]?.user ?? null }).map((e) => ({ ...e, organizationId: t.organizationId, taskId: t.id })),
      }),
    ]);
  }
  console.log(`Rebuilt calendar for ${tasks.length} tasks`);
}
main().finally(() => db.$disconnect());
