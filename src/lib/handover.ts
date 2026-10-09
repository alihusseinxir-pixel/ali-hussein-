import "server-only";
import { AR_ROLE, AR_STAGE } from "./i18n/ar";
import type { Prisma, Task, TaskStage } from "@prisma/client";
import { db } from "./db";
import { env } from "./env";
import { parseLocalDateTime } from "./datetime";
import { logActivity } from "./activity";
import { ForbiddenError, can } from "./rbac";
import { exitPermission, handoverRules, isHandoverStage, nextStage, revisionTarget, stageOwnerRoles} from "./workflow";
import { TaskError, type Actor } from "./tasks";
import { syncTaskCalendar } from "./calendar-sync";
import { filesSinceLastHandover } from "./files";
import { contextSnapshot } from "./task-context";
import type { HandoverInput } from "./handover-schema";

async function loadTask(tx: Prisma.TransactionClient, actor: Actor, id: string) {
  const task = await tx.task.findFirst({ where: { id, organizationId: actor.organizationId, deletedAt: null } });
  if (!task) throw new TaskError("المهمة غير موجودة.");
  return task;
}

function assertOwner(actor: Actor, task: Task) {
  if (task.currentAssigneeId !== actor.id && actor.role !== "ADMIN") {
    throw new ForbiddenError("المالك الحالي فقط يستطيع نقل هذه المهمة.");
  }
}

async function assertNoPendingIncoming(tx: Prisma.TransactionClient, actor: Actor, task: Task) {
  const pending = await tx.taskHandoff.count({ where: { taskId: task.id, toUserId: actor.id, status: "PENDING" } });
  if (pending > 0 && task.currentAssigneeId === actor.id) throw new TaskError("أكّد التسليم الذي استلمته قبل تمرير المهمة.");
}

/** Move the task to `toStage` owned by `toUserId`, recording assignment, handover, activity, notification. */
async function moveTask(
  tx: Prisma.TransactionClient, actor: Actor, task: Task,
  m: { toStage: TaskStage; toUserId: string; instructions: string | null; requiredOutput?: string | null; deadline?: Date | null; reason?: string | null; payload?: Prisma.InputJsonValue; notification: "HANDOVER" | "REVISION_REQUESTED"; action: string },
) {
  const claimed = await tx.task.updateMany({
    where: { id: task.id, stage: task.stage, currentAssigneeId: task.currentAssigneeId, deletedAt: null },
    data: { stage: m.toStage, currentAssigneeId: m.toUserId, ...(m.deadline && { deadline: m.deadline }) },
  });
  if (claimed.count === 0) throw new TaskError("تغيّرت المهمة للتو بيد شخص آخر. أعد التحميل وحاول مجدداً.");
  await tx.taskAssignment.updateMany({ where: { taskId: task.id, releasedAt: null }, data: { releasedAt: new Date() } });
  await tx.taskAssignment.create({ data: { taskId: task.id, userId: m.toUserId, stage: m.toStage } });
  const handoff = await tx.taskHandoff.create({
    data: {
      taskId: task.id, fromUserId: task.currentAssigneeId ?? actor.id, toUserId: m.toUserId, fromStage: task.stage, toStage: m.toStage,
      instructions: m.instructions ?? "", requiredOutput: m.requiredOutput ?? null, deadline: m.deadline ?? null,
      reason: m.reason ?? null, payload: m.payload,
      // Handing a task to yourself (e.g. Social Media scheduling their own content) needs no confirmation.
      ...(m.toUserId === task.currentAssigneeId && { status: "ACCEPTED" as const, acceptedAt: new Date() }),
    },
  });
  const label = `${task.taskCode}: ${task.title}`;
  if (m.toUserId !== actor.id) {
    await tx.notification.create({
      data: {
        organizationId: actor.organizationId, userId: m.toUserId, taskId: task.id, type: m.notification,
        message: m.notification === "REVISION_REQUESTED" ? `طُلبت تعديلات على ${label}` : `تسليم جديد إليك (${AR_STAGE[m.toStage]}): ${label}`,
      },
    });
  }
  await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId: task.id, action: m.action,
    meta: { handoffId: handoff.id, fromStage: task.stage, toStage: m.toStage, fromUserId: task.currentAssigneeId, toUserId: m.toUserId } });
  if (m.deadline && task.deadline?.getTime() !== m.deadline.getTime()) {
    await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId: task.id, action: "task.deadline_changed",
      meta: { from: task.deadline?.toISOString() ?? null, to: m.deadline.toISOString() } });
  }
  await syncTaskCalendar(tx, task.id);
  return handoff;
}

/** Forward handover: current owner → next stage / next owner. */
const APPROVAL_STAGES: TaskStage[] = ["PRODUCTION_REVIEW", "EDITING_REVIEW", "INTERNAL_APPROVAL", "SOCIAL_APPROVAL"];

export async function submitHandover(actor: Actor, taskId: string, input: HandoverInput) {
  return db.$transaction(async (tx) => {
    const task = await loadTask(tx, actor, taskId);
    assertOwner(actor, task);
    if (!isHandoverStage(task.stage)) throw new TaskError(task.stage === "ASSIGNED" ? "يبدأ المسؤول العمل بتأكيد الإسناد." : "لا يوجد ما يُسلَّم من هذه المرحلة.");
    const to = nextStage(task.contentType, task.stage);
    if (!to) throw new TaskError("لا توجد مرحلة تالية لهذه المهمة.");
    const need = exitPermission(task.stage);
    if (need && !can(actor.role, need)) throw new ForbiddenError();
    await assertNoPendingIncoming(tx, actor, task);

    const rules = handoverRules(task.stage, to);
    const receiver = await tx.user.findFirst({ where: { id: input.toUserId, organizationId: actor.organizationId, status: "ACTIVE", deletedAt: null } });
    if (!receiver) throw new TaskError("المستلم غير موجود.");
    if (!stageOwnerRoles(to).includes(receiver.role)) {
      throw new TaskError(`مرحلة "${AR_STAGE[to]}" يتولاها: ${stageOwnerRoles(to).map((r) => AR_ROLE[r]).join(" أو ")}.`);
    }
    if (receiver.id !== actor.id && !input.instructions) throw new TaskError("تعليمات المستلم مطلوبة.");
    if (rules.needsDeliverables && !input.deliverables) throw new TaskError("صف ما تسلّمه (ملاحظات، لقطات، نسخ).");
    let deadline: Date | null = null;
    if (input.deadline) {
      deadline = parseLocalDateTime(input.deadline, env.timezone);
      if (!deadline) throw new TaskError("الموعد النهائي غير صالح.");
    }
    const files = await filesSinceLastHandover(tx, taskId);
    if (rules.requiredFileKind && !files.some((f) => f.kind === rules.requiredFileKind)) {
      throw new TaskError(rules.requiredFileKind === "RAW" ? "ارفع اللقطات/الصور الخام (النوع: Raw) قبل التسليم." : "ارفع المخرج النهائي (النوع: Final) قبل التسليم.");
    }
    if (rules.needsDeadline && !deadline) throw new TaskError(`حدّد موعداً نهائياً لمرحلة "${AR_STAGE[to]}".`);
    if (rules.needsPublishAt && !task.publishAt) throw new TaskError("حدّد موعد النشر في المهمة قبل جدولتها.");

    const submitter = APPROVAL_STAGES.includes(task.stage)
      ? await tx.taskHandoff.findFirst({ where: { taskId, toStage: task.stage }, orderBy: { createdAt: "desc" }, select: { fromUserId: true } })
      : null;
    const handoff = await moveTask(tx, actor, task, {
      toStage: to, toUserId: receiver.id, instructions: input.instructions, requiredOutput: input.requiredOutput, deadline,
      reason: input.comments, notification: "HANDOVER", action: "handover.created",
      payload: { deliverables: input.deliverables, files, context: contextSnapshot(task) },
    });
    // Moving forward out of a review/approval stage IS the approval: record who approved, when, and why.
    if (APPROVAL_STAGES.includes(task.stage)) {
      await tx.taskApproval.create({ data: { taskId, approverId: actor.id, stage: task.stage, status: "APPROVED", comments: input.comments ?? input.instructions } });
      await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId, action: "task.approved", meta: { stage: task.stage } });
      for (const uid of new Set([submitter?.fromUserId, task.stage === "SOCIAL_APPROVAL" ? task.createdById : null])) {
        if (uid && uid !== actor.id) {
          await tx.notification.create({ data: { organizationId: actor.organizationId, userId: uid, taskId, type: "TASK_APPROVED", message: `تمت الموافقة على مرحلة "${AR_STAGE[task.stage]}": ${task.taskCode} ${task.title}` } });
        }
      }
    }
    // Delivering new work answers any open revision requests.
    if (task.stage === "PRODUCTION" || task.stage === "EDITING") {
      await tx.taskRevision.updateMany({ where: { taskId, resolvedAt: null }, data: { resolvedAt: new Date() } });
    }
    return handoff;
  });
}

/** Reviewer sends the task back to whoever last did the work (revision loop). */
export async function requestChanges(actor: Actor, taskId: string, notes: string) {
  return db.$transaction(async (tx) => {
    const task = await loadTask(tx, actor, taskId);
    assertOwner(actor, task);
    const target = revisionTarget(task.contentType, task.stage);
    if (!target) throw new TaskError("يمكن طلب التعديلات أثناء المراجعة أو الموافقة فقط.");
    const need = exitPermission(task.stage);
    if (need && !can(actor.role, need)) throw new ForbiddenError();
    const last = await tx.taskAssignment.findFirst({ where: { taskId, stage: target }, orderBy: { assignedAt: "desc" } });
    if (!last) throw new TaskError("لم يعمل أحد على هذه المرحلة بعد.");
    const user = await tx.user.findFirst({ where: { id: last.userId, organizationId: actor.organizationId, status: "ACTIVE", deletedAt: null } });
    if (!user) throw new TaskError("المالك السابق لم يعد نشطاً؛ اطلب من المدير إعادة الإسناد.");
    await tx.taskRevision.create({ data: { taskId, stage: task.stage, requestedBy: actor.id, notes } });
    await tx.taskApproval.create({ data: { taskId, approverId: actor.id, stage: task.stage, status: "CHANGES_REQUESTED", comments: notes } });
    return moveTask(tx, actor, task, {
      toStage: target, toUserId: user.id, instructions: notes, reason: notes, notification: "REVISION_REQUESTED", action: "revision.requested",
      payload: { context: contextSnapshot(task) },
    });
  });
}

/** Receiver confirms a handover. Confirming the initial assignment starts the work stage. */
export async function acceptHandover(actor: Actor, handoffId: string) {
  return db.$transaction(async (tx) => {
    const h = await tx.taskHandoff.findFirst({ where: { id: handoffId, toUserId: actor.id, status: "PENDING", task: { organizationId: actor.organizationId, deletedAt: null } }, include: { task: true } });
    if (!h) throw new TaskError("لا يوجد ما يُؤكَّد.");
    await tx.taskHandoff.update({ where: { id: h.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
    await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId: h.taskId, action: "handover.accepted", meta: { handoffId: h.id } });
    const t = h.task;
    if (t.stage === "ASSIGNED" && t.currentAssigneeId === actor.id) {
      const to = nextStage(t.contentType, "ASSIGNED");
      if (to) {
        const r = await tx.task.updateMany({ where: { id: t.id, stage: "ASSIGNED", currentAssigneeId: actor.id }, data: { stage: to } });
        if (r.count) {
          await tx.taskAssignment.updateMany({ where: { taskId: t.id, releasedAt: null }, data: { stage: to } });
          await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId: t.id, action: "stage.changed", meta: { from: "ASSIGNED", to } });
          await syncTaskCalendar(tx, t.id);
        }
      }
    }
  });
}
