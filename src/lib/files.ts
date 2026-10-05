import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma, type Task } from "@prisma/client";
import { db } from "./db";
import { logActivity } from "./activity";
import { ForbiddenError, can } from "./rbac";
import { FILE_KINDS, detectType, extensionOf, safeFileName, type FileKind } from "./file-types";
import { storage } from "./storage";
import { TaskError, visibleTasksWhere, type Actor } from "./tasks";

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 100) * 1024 * 1024;

function canUpload(actor: Actor, task: Task) {
  if (["PUBLISHED", "COMPLETED"].includes(task.stage)) return false;
  return actor.role === "ADMIN" || task.currentAssigneeId === actor.id || task.createdById === actor.id || can(actor.role, "task:edit:any");
}

async function visibleTask(actor: Actor, taskId: string) {
  return db.task.findFirst({ where: { AND: [visibleTasksWhere(actor), { id: taskId }] } });
}

export async function uploadFile(actor: Actor, taskId: string, file: File, kind: string, commentId?: string | null) {
  const task = await visibleTask(actor, taskId);
  if (!task) throw new TaskError("Task not found.");
  if (commentId) {
    // Commenters may attach files to their own comment even if they do not own the task.
    const c = await db.taskComment.findFirst({ where: { id: commentId, taskId, authorId: actor.id, deletedAt: null } });
    if (!c) throw new ForbiddenError("You can only attach files to your own comment.");
  } else if (!canUpload(actor, task)) throw new ForbiddenError("You cannot add files to this task right now.");
  if (!(FILE_KINDS as readonly string[]).includes(kind)) throw new TaskError("Unknown file kind.");
  if (file.size === 0) throw new TaskError("The file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) throw new TaskError(`File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  const fileName = safeFileName(file.name);
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const type = detectType(fileName, head);
  if (!type) throw new TaskError("Unsupported or corrupted file. Allowed: PDF, JPG, PNG, MP4, MOV, DOCX, XLSX.");

  const key = `${actor.organizationId}/${taskId}/${randomUUID()}.${extensionOf(fileName)}`;
  await storage.put(key, file.stream() as ReadableStream<Uint8Array>);
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(async (tx) => {
          // Same name + kind on the same task = a new version of that file.
          const last = await tx.taskAttachment.aggregate({ where: { taskId, kind, fileName }, _max: { version: true } });
          const version = (last._max.version ?? 0) + 1;
          const row = await tx.taskAttachment.create({
            data: { taskId, commentId: commentId ?? null, uploadedById: actor.id, fileName, fileUrl: key, fileType: type.mime, kind, sizeBytes: file.size, version },
          });
          await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId, action: version > 1 ? "file.replaced" : "file.uploaded", meta: { fileName, kind, version } });
          return row;
        });
      } catch (e) {
        if (attempt < 2 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // concurrent upload of same name
        throw e;
      }
    }
  } catch (e) {
    await storage.remove(key); // don't leave orphaned blobs
    throw e;
  }
}

export async function listFiles(actor: Actor, taskId: string) {
  return db.taskAttachment.findMany({
    where: { taskId, deletedAt: null, task: { AND: [visibleTasksWhere(actor), { id: taskId }] } },
    include: { uploadedBy: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function getFileForUser(actor: Actor, id: string) {
  return db.taskAttachment.findFirst({ where: { id, deletedAt: null, task: visibleTasksWhere(actor) } });
}

/** Soft delete: the row and blob are kept so history (and handover snapshots) stay intact. */
export async function deleteFile(actor: Actor, id: string) {
  const f = await getFileForUser(actor, id);
  if (!f) throw new TaskError("File not found.");
  const task = await db.task.findUniqueOrThrow({ where: { id: f.taskId } });
  if (!canUpload(actor, task) || !(f.uploadedById === actor.id || can(actor.role, "task:edit:any"))) throw new ForbiddenError();
  await db.$transaction(async (tx) => {
    await tx.taskAttachment.update({ where: { id }, data: { deletedAt: new Date() } });
    await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId: f.taskId, action: "file.deleted", meta: { fileName: f.fileName, version: f.version } });
  });
}

/** Files delivered since the task was last handed over (used to gate and to snapshot handovers). */
export async function filesSinceLastHandover(tx: Prisma.TransactionClient, taskId: string) {
  const last = await tx.taskHandoff.findFirst({ where: { taskId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return tx.taskAttachment.findMany({
    where: { taskId, deletedAt: null, commentId: null, ...(last && { createdAt: { gt: last.createdAt } }) },
    select: { id: true, fileName: true, kind: true, version: true },
    orderBy: { createdAt: "asc" },
  });
}
