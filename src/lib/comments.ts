import "server-only";
import { db } from "./db";
import { logActivity } from "./activity";
import { ForbiddenError, can } from "./rbac";
import { extractMentions } from "./mentions";
import { TaskError, visibleTasksWhere, type Actor } from "./tasks";

/** Everyone who is allowed to see this task (and can therefore be @mentioned). */
export async function taskParticipants(actor: Actor, taskId: string) {
  const task = await db.task.findFirst({
    where: { AND: [visibleTasksWhere(actor), { id: taskId }] },
    select: { id: true, createdById: true, currentAssigneeId: true, taskCode: true, title: true, assignments: { select: { userId: true } } },
  });
  if (!task) return null;
  const involved = [task.createdById, task.currentAssigneeId, ...task.assignments.map((a) => a.userId)].filter((x): x is string => !!x);
  const viewAllRoles = (["ADMIN", "MARKETING_MANAGER", "SOCIAL_MEDIA_MANAGER", "VIDEOGRAPHER", "PHOTOGRAPHER", "VIDEO_EDITOR", "DESIGNER"] as const).filter((r) => can(r, "task:view:all"));
  const people = await db.user.findMany({
    where: { organizationId: actor.organizationId, status: "ACTIVE", deletedAt: null, OR: [{ id: { in: involved } }, { role: { in: [...viewAllRoles] } }] },
    select: { id: true, name: true }, orderBy: { name: "asc" },
  });
  return { task, people };
}

export async function addComment(actor: Actor, taskId: string, body: string) {
  if (!can(actor.role, "task:comment")) throw new ForbiddenError();
  const ctx = await taskParticipants(actor, taskId);
  if (!ctx) throw new TaskError("المهمة غير موجودة.");
  const text = body.trim();
  if (!text) throw new TaskError("اكتب تعليقاً أولاً.");
  if (text.length > 5000) throw new TaskError("التعليق طويل جداً.");
  const mentions = extractMentions(text, ctx.people).filter((id) => id !== actor.id);
  return db.$transaction(async (tx) => {
    const c = await tx.taskComment.create({ data: { taskId, authorId: actor.id, body: text, mentions } });
    const label = `${ctx.task.taskCode}: ${ctx.task.title}`;
    const notified = new Set<string>();
    for (const id of mentions) {
      notified.add(id);
      await tx.notification.create({ data: { organizationId: actor.organizationId, userId: id, taskId, type: "MENTION", message: `تمت الإشارة إليك في ${label}` } });
    }
    for (const id of [ctx.task.currentAssigneeId, ctx.task.createdById]) {
      if (id && id !== actor.id && !notified.has(id)) {
        notified.add(id);
        await tx.notification.create({ data: { organizationId: actor.organizationId, userId: id, taskId, type: "COMMENT", message: `تعليق جديد على ${label}` } });
      }
    }
    await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId, action: "comment.added", meta: { commentId: c.id } });
    return c;
  });
}

export async function listComments(actor: Actor, taskId: string) {
  return db.taskComment.findMany({
    where: { taskId, deletedAt: null, task: { AND: [visibleTasksWhere(actor), { id: taskId }] } },
    include: { author: { select: { id: true, name: true, role: true } }, attachments: { where: { deletedAt: null }, select: { id: true, fileName: true, version: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function deleteComment(actor: Actor, commentId: string) {
  const c = await db.taskComment.findFirst({ where: { id: commentId, deletedAt: null, task: visibleTasksWhere(actor) } });
  if (!c) throw new TaskError("التعليق غير موجود.");
  if (c.authorId !== actor.id && actor.role !== "ADMIN") throw new ForbiddenError();
  await db.$transaction(async (tx) => {
    await tx.taskComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId: c.taskId, action: "comment.deleted", meta: { commentId } });
  });
}
