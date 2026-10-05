import type { Prisma } from "@prisma/client";
import { db } from "./db";
import type { Actor } from "./tasks";

export const NOTIFICATION_PAGE_SIZE = 25;

/** A user only ever reads their own notifications (and never ones for deleted tasks). */
const mine = (actor: Actor): Prisma.NotificationWhereInput => ({
  organizationId: actor.organizationId,
  userId: actor.id,
  OR: [{ taskId: null }, { task: { deletedAt: null } }],
});

export async function unreadCount(actor: Actor) {
  return db.notification.count({ where: { ...mine(actor), readAt: null } });
}

export async function listNotifications(actor: Actor, o: { unreadOnly?: boolean; page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(100, Math.max(1, o.pageSize ?? NOTIFICATION_PAGE_SIZE));
  const page = Math.max(1, o.page ?? 1);
  const where: Prisma.NotificationWhereInput = { ...mine(actor), ...(o.unreadOnly && { readAt: null }) };
  const [items, total] = await Promise.all([
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.notification.count({ where }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function markRead(actor: Actor, ids: string[]) {
  if (ids.length === 0) return 0;
  const r = await db.notification.updateMany({ where: { ...mine(actor), id: { in: ids }, readAt: null }, data: { readAt: new Date() } });
  return r.count;
}

export async function markAllRead(actor: Actor) {
  return (await db.notification.updateMany({ where: { ...mine(actor), readAt: null }, data: { readAt: new Date() } })).count;
}

export async function setEmailPreference(actor: Actor, enabled: boolean) {
  await db.user.update({ where: { id: actor.id }, data: { emailNotifications: enabled } });
}
