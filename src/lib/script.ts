import "server-only";
import { Prisma, type ScriptStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { logActivity } from "./activity";
import { ForbiddenError, can } from "./rbac";
import { TaskError, visibleTasksWhere, type Actor } from "./tasks";
import { EDITABLE, findTransition } from "./script-workflow";

export const MAX_SCENES = 100;
const opt = (max: number) => z.string().trim().max(max, `الحد الأقصى ${max} حرفاً`).optional().transform((v) => (v ? v : null));

export const sceneSchema = z.object({
  durationSec: z.number().int("المدة يجب أن تكون رقماً صحيحاً").min(0).max(3600, "المدة الأقصى 3600 ثانية").nullable().optional().transform((v) => v ?? null),
  shotDescription: z.string().trim().min(1, "وصف اللقطة مطلوب").max(2000, "الحد الأقصى 2000 حرف"),
  cameraAngle: opt(500), visualAction: opt(2000), dialogue: opt(4000), onScreenText: opt(1000), audio: opt(1000), props: opt(1000), notes: opt(2000),
});
export const scenesSchema = z.array(sceneSchema).max(MAX_SCENES, `الحد الأقصى ${MAX_SCENES} مشهداً`);
export type SceneInput = z.input<typeof sceneSchema>;
export type SceneData = z.output<typeof sceneSchema>;

const canEditTask = (actor: Actor, createdById: string) =>
  can(actor.role, "task:edit:any") || (can(actor.role, "task:edit:own") && createdById === actor.id);

async function loadTask(actor: Actor, taskId: string) {
  const t = await db.task.findFirst({ where: { AND: [visibleTasksWhere(actor), { id: taskId }] } });
  if (!t) throw new TaskError("المهمة غير موجودة.");
  return t;
}

export async function getScript(actor: Actor, taskId: string) {
  const task = await loadTask(actor, taskId);
  const [scenes, revisions] = await Promise.all([
    db.scriptScene.findMany({ where: { taskId }, orderBy: { position: "asc" } }),
    db.scriptRevision.findMany({ where: { taskId }, orderBy: { version: "desc" }, take: 30 }),
  ]);
  const names = await db.user.findMany({ where: { id: { in: [...new Set(revisions.map((r) => r.actorId))] } }, select: { id: true, name: true } });
  const nameOf = new Map(names.map((u) => [u.id, u.name]));
  return {
    task, scenes, version: revisions[0]?.version ?? 0,
    revisions: revisions.map((r) => ({ ...r, actorName: nameOf.get(r.actorId) ?? "—" })),
    perms: { editor: canEditTask(actor, task.createdById), reviewer: can(actor.role, "approval:internal") },
  };
}

type Tx = Prisma.TransactionClient;
async function latestVersion(tx: Tx, taskId: string) {
  return (await tx.scriptRevision.findFirst({ where: { taskId }, orderBy: { version: "desc" }, select: { version: true } }))?.version ?? 0;
}
async function addRevision(tx: Tx, taskId: string, actorId: string, action: string, note: string | null, expected: number) {
  if ((await latestVersion(tx, taskId)) !== expected) throw new TaskError("تم تعديل السكريبت من قبل شخص آخر. أعد تحميل الصفحة لرؤية آخر نسخة.");
  const scenes = await tx.scriptScene.findMany({ where: { taskId }, orderBy: { position: "asc" }, omit: { id: true, taskId: true, createdAt: true, updatedAt: true } });
  const status = (await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: { scriptStatus: true } })).scriptStatus;
  await tx.scriptRevision.create({ data: { taskId, version: expected + 1, actorId, action, note, snapshot: { status, scenes } } });
  return expected + 1;
}
const conflict = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const CONFLICT_MSG = "تم تعديل السكريبت من قبل شخص آخر. أعد تحميل الصفحة لرؤية آخر نسخة.";

/** Replace the whole scene list. `expectedVersion` is the revision the client loaded (optimistic concurrency). */
export async function saveScenes(actor: Actor, taskId: string, scenesIn: SceneInput[], expectedVersion: number) {
  const task = await loadTask(actor, taskId);
  if (!canEditTask(actor, task.createdById)) throw new ForbiddenError("ليست لديك صلاحية تعديل السكريبت.");
  if (!EDITABLE.includes(task.scriptStatus)) throw new TaskError("السكريبت مقفل للتعديل. أعده إلى مسودة أولاً.");
  if (["PUBLISHED", "COMPLETED"].includes(task.stage)) throw new TaskError("المهمة المنشورة أو المكتملة للقراءة فقط.");
  const parsed = scenesSchema.safeParse(scenesIn);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    const where = typeof i.path[0] === "number" ? `المشهد ${i.path[0] + 1}: ` : "";
    throw new TaskError(`${where}${i.message}`);
  }
  try {
    return await db.$transaction(async (tx) => {
      await tx.scriptScene.deleteMany({ where: { taskId } });
      await tx.scriptScene.createMany({ data: parsed.data.map((s, position) => ({ ...s, taskId, position })) });
      const version = await addRevision(tx, taskId, actor.id, "saved", null, expectedVersion);
      await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId, action: "script.saved", meta: { scenes: parsed.data.length, version } });
      return { version, count: parsed.data.length };
    });
  } catch (e) {
    if (conflict(e)) throw new TaskError(CONFLICT_MSG);
    throw e;
  }
}

export async function changeScriptStatus(actor: Actor, taskId: string, to: ScriptStatus, note: string | null, expectedVersion: number) {
  const task = await loadTask(actor, taskId);
  const t = findTransition(task.scriptStatus, to);
  if (!t) throw new TaskError("لا يمكن الانتقال إلى هذه الحالة من الحالة الحالية.");
  const allowed = t.who === "editor" ? canEditTask(actor, task.createdById) : can(actor.role, "approval:internal");
  if (!allowed) throw new ForbiddenError("ليست لديك صلاحية لهذا الإجراء.");
  const cleanNote = note?.trim() || null;
  if (t.needsNote && !cleanNote) throw new TaskError("اكتب ملاحظات التعديل المطلوبة.");
  if (to === "IN_REVIEW" && (await db.scriptScene.count({ where: { taskId } })) === 0) throw new TaskError("أضف مشهداً واحداً على الأقل قبل الإرسال للمراجعة.");
  try {
    return await db.$transaction(async (tx) => {
      // compare-and-set: of two simultaneous changes from the same status, only one wins
      const r = await tx.task.updateMany({ where: { id: taskId, scriptStatus: task.scriptStatus }, data: { scriptStatus: to } });
      if (r.count !== 1) throw new TaskError(CONFLICT_MSG);
      const version = await addRevision(tx, taskId, actor.id, `status:${to}`, cleanNote, expectedVersion);
      await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId, action: "script.status", meta: { from: task.scriptStatus, to, note: cleanNote } });
      if (to === "CHANGES_REQUESTED" && task.createdById !== actor.id) {
        await tx.notification.create({ data: { organizationId: actor.organizationId, userId: task.createdById, taskId, type: "REVISION_REQUESTED",
          message: `طُلبت تعديلات على سكريبت ${task.taskCode}: ${task.title}` } });
      }
      return { version, status: to };
    });
  } catch (e) {
    if (conflict(e)) throw new TaskError(CONFLICT_MSG);
    throw e;
  }
}
