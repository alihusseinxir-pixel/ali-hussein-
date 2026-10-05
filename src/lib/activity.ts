import type { Prisma, PrismaClient } from "@prisma/client";

type Client = PrismaClient | Prisma.TransactionClient;

export async function logActivity(
  client: Client,
  entry: { organizationId: string; actorId: string | null; action: string; taskId?: string | null; meta?: Prisma.InputJsonValue },
) {
  await client.activityLog.create({
    data: {
      organizationId: entry.organizationId,
      actorId: entry.actorId,
      action: entry.action,
      taskId: entry.taskId ?? null,
      meta: entry.meta,
    },
  });
}
