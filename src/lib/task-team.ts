import "server-only";
import { db } from "./db";
import { logActivity } from "./activity";
import { ForbiddenError, can } from "./rbac";
import { TaskError, visibleTasksWhere, type Actor } from "./tasks";

const CLOSED = ["PUBLISHED", "COMPLETED"];

async function loadTask(a: Actor, taskId: string) {
  const t = await db.task.findFirst({ where: { AND: [visibleTasksWhere(a), { id: taskId }] }, include: { collaborators: { select: { userId: true } } } });
  if (!t) throw new TaskError("المهمة غير موجودة.");
  return t;
}
type T = Awaited<ReturnType<typeof loadTask>>;

/** May change who is on the task: editors and anyone who can assign. */
const canManageTeam = (a: Actor, t: T) =>
  can(a.role, "task:edit:any") || can(a.role, "task:assign") || (can(a.role, "task:edit:own") && t.createdById === a.id);
/** May work the checklist: the owner, collaborators and team managers. */
export const canWorkChecklist = (a: Actor, t: T) => canManageTeam(a, t) || t.currentAssigneeId === a.id || t.collaborators.some((c) => c.userId === a.id);
const assertOpen = (t: T) => { if (CLOSED.includes(t.stage)) throw new TaskError("المهمة المنشورة أو المكتملة للقراءة فقط."); };

// ───────── collaborators ─────────
export async function addCollaborator(a: Actor, taskId: string, userId: string) {
  const t = await loadTask(a, taskId);
  if (!canManageTeam(a, t)) throw new ForbiddenError("ليست لديك صلاحية إدارة المتعاونين.");
  assertOpen(t);
  if (userId === t.currentAssigneeId) throw new TaskError("المسؤول عن المهمة لا يُضاف كمتعاون.");
  const u = await db.user.findFirst({ where: { id: userId, organizationId: a.organizationId, status: "ACTIVE", deletedAt: null } });
  if (!u) throw new TaskError("العضو غير موجود.");
  if (t.collaborators.some((c) => c.userId === userId)) throw new TaskError("العضو متعاون بالفعل.");
  await db.$transaction(async (tx) => {
    await tx.taskCollaborator.create({ data: { taskId, userId, addedBy: a.id } });
    await logActivity(tx, { organizationId: a.organizationId, actorId: a.id, taskId, action: "task.collaborator_added", meta: { userId } });
    if (userId !== a.id) await tx.notification.create({ data: { organizationId: a.organizationId, userId, taskId, type: "TASK_ASSIGNED", message: `تمت إضافتك كمتعاون في ${t.taskCode}: ${t.title}` } });
  });
}

export async function removeCollaborator(a: Actor, taskId: string, userId: string) {
  const t = await loadTask(a, taskId);
  if (!canManageTeam(a, t) && userId !== a.id) throw new ForbiddenError("ليست لديك صلاحية إدارة المتعاونين."); // anyone may leave a task
  assertOpen(t);
  const r = await db.taskCollaborator.deleteMany({ where: { taskId, userId } });
  if (r.count === 1) await logActivity(db, { organizationId: a.organizationId, actorId: a.id, taskId, action: "task.collaborator_removed", meta: { userId } });
}

export async function listCollaborators(a: Actor, taskId: string) {
  await loadTask(a, taskId);
  return db.taskCollaborator.findMany({ where: { taskId }, include: { user: { select: { id: true, name: true, role: true } } }, orderBy: { addedAt: "asc" } });
}

// ───────── checklist ─────────
export async function addTaskChecklistItem(a: Actor, taskId: string, label: string, sourceSceneNumber: number | null = null) {
  const t = await loadTask(a, taskId);
  if (!canWorkChecklist(a, t)) throw new ForbiddenError("ليست لديك صلاحية تعديل القائمة.");
  assertOpen(t);
  const clean = label.trim();
  if (!clean || clean.length > 300) throw new TaskError("نص العنصر مطلوب (300 حرف كحد أقصى).");
  if ((await db.taskChecklistItem.count({ where: { taskId } })) >= 100) throw new TaskError("الحد الأقصى 100 عنصر.");
  const last = await db.taskChecklistItem.findFirst({ where: { taskId }, orderBy: { position: "desc" } });
  await db.taskChecklistItem.create({ data: { taskId, label: clean, position: (last?.position ?? -1) + 1, sourceSceneNumber } });
}

async function itemTask(a: Actor, itemId: string) {
  const item = await db.taskChecklistItem.findUnique({ where: { id: itemId } });
  if (!item) throw new TaskError("العنصر غير موجود.");
  const t = await loadTask(a, item.taskId);
  if (!canWorkChecklist(a, t)) throw new ForbiddenError("ليست لديك صلاحية تعديل القائمة.");
  assertOpen(t);
  return item;
}
export async function setTaskChecklistDone(a: Actor, itemId: string, done: boolean) {
  const item = await itemTask(a, itemId);
  await db.taskChecklistItem.update({ where: { id: itemId }, data: { done, doneById: done ? a.id : null, doneAt: done ? new Date() : null } });
  return item.taskId;
}
export async function removeTaskChecklistItem(a: Actor, itemId: string) {
  const item = await itemTask(a, itemId);
  await db.taskChecklistItem.delete({ where: { id: itemId } });
  return item.taskId;
}
export const listTaskChecklist = async (a: Actor, taskId: string) => { await loadTask(a, taskId); return db.taskChecklistItem.findMany({ where: { taskId }, orderBy: { position: "asc" } }); };
