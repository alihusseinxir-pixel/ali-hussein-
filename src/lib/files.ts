import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma, type Task } from "@prisma/client";
import { db } from "./db";
import { logActivity } from "./activity";
import { ForbiddenError, can } from "./rbac";
import { FILE_KINDS, FILE_TYPES, detectType, extensionOf, safeFileName } from "./file-types";
import { PRESIGN_TTL_SECONDS, storage } from "./storage";
import { makeUploadToken, parseUploadToken } from "./upload-token";
import { TaskError, visibleTasksWhere, type Actor } from "./tasks";

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 100) * 1024 * 1024;

function canUpload(actor: Actor, task: Task) {
  if (["PUBLISHED", "COMPLETED"].includes(task.stage)) return false;
  return actor.role === "ADMIN" || task.currentAssigneeId === actor.id || task.createdById === actor.id || can(actor.role, "task:edit:any");
}

async function visibleTask(actor: Actor, taskId: string) {
  return db.task.findFirst({ where: { AND: [visibleTasksWhere(actor), { id: taskId }] } });
}

/** Everything that must be true before any bytes are accepted (shared by both upload paths). */
async function authorizeUpload(actor: Actor, taskId: string, kind: string, commentId?: string | null) {
  const task = await visibleTask(actor, taskId);
  if (!task) throw new TaskError("المهمة غير موجودة.");
  if (commentId) {
    // Commenters may attach files to their own comment even if they do not own the task.
    const c = await db.taskComment.findFirst({ where: { id: commentId, taskId, authorId: actor.id, deletedAt: null } });
    if (!c) throw new ForbiddenError("يمكنك إرفاق الملفات بتعليقك فقط.");
  } else if (!canUpload(actor, task)) throw new ForbiddenError("لا يمكنك إضافة ملفات إلى هذه المهمة الآن.");
  if (!(FILE_KINDS as readonly string[]).includes(kind)) throw new TaskError("نوع الملف غير معروف.");
}

function checkSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) throw new TaskError("الملف فارغ.");
  if (size > MAX_UPLOAD_BYTES) throw new TaskError(`حجم الملف أكبر من ${MAX_UPLOAD_BYTES / 1024 / 1024} ميغابايت.`);
}

const UNSUPPORTED = "ملف غير مدعوم أو تالف. المسموح: PDF, JPG, PNG, MP4, MOV, DOCX, XLSX.";

/** Insert the attachment row (+ activity) with the next version number; retried on a concurrent same-name upload. */
async function recordAttachment(actor: Actor, a: { taskId: string; commentId: string | null; fileName: string; key: string; mime: string; kind: string; size: number }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        // Same name + kind on the same task = a new version of that file.
        const last = await tx.taskAttachment.aggregate({ where: { taskId: a.taskId, kind: a.kind, fileName: a.fileName }, _max: { version: true } });
        const version = (last._max.version ?? 0) + 1;
        const row = await tx.taskAttachment.create({
          data: { taskId: a.taskId, commentId: a.commentId, uploadedById: actor.id, fileName: a.fileName, fileUrl: a.key, fileType: a.mime, kind: a.kind, sizeBytes: a.size, version },
        });
        await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId: a.taskId, action: version > 1 ? "file.replaced" : "file.uploaded", meta: { fileName: a.fileName, kind: a.kind, version } });
        return row;
      });
    } catch (e) {
      if (attempt < 2 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // concurrent upload of same name
      throw e;
    }
  }
}

/** Proxy path: the browser posts the file to the app, which validates and stores it. */
export async function uploadFile(actor: Actor, taskId: string, file: File, kind: string, commentId?: string | null) {
  await authorizeUpload(actor, taskId, kind, commentId);
  checkSize(file.size);
  const fileName = safeFileName(file.name);
  const type = detectType(fileName, new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!type) throw new TaskError(UNSUPPORTED);

  const key = `${actor.organizationId}/${taskId}/${randomUUID()}.${extensionOf(fileName)}`;
  await storage.put(key, file.stream() as ReadableStream<Uint8Array>);
  try {
    return await recordAttachment(actor, { taskId, commentId: commentId ?? null, fileName, key, mime: type.mime, kind, size: file.size });
  } catch (e) {
    await storage.remove(key); // don't leave orphaned blobs
    throw e;
  }
}

export type UploadPlan =
  | { mode: "proxy" }
  | { mode: "direct"; url: string; headers: Record<string, string>; token: string; expiresInSeconds: number };

/**
 * Step 1 of the direct-to-bucket flow. Authorises the upload and, when the storage driver supports it, returns a
 * short-lived presigned PUT URL for a quarantined key (`pending/…`). Nothing is trusted yet: see completeDirectUpload.
 */
export async function planUpload(actor: Actor, taskId: string, req: { fileName: string; size: number; kind: string; commentId?: string | null }): Promise<UploadPlan> {
  await authorizeUpload(actor, taskId, req.kind, req.commentId);
  checkSize(req.size);
  const fileName = safeFileName(req.fileName);
  const ext = extensionOf(fileName);
  const type = FILE_TYPES[ext];
  if (!type) throw new TaskError(UNSUPPORTED);
  if (!storage.direct) return { mode: "proxy" };
  const key = `pending/${actor.organizationId}/${taskId}/${randomUUID()}.${ext}`;
  const { url, headers } = await storage.direct.presignUpload(key, { contentType: type.mime, contentLength: req.size, expiresSeconds: PRESIGN_TTL_SECONDS });
  const token = makeUploadToken({ taskId, userId: actor.id, key, fileName, kind: req.kind, commentId: req.commentId ?? null, size: req.size, mime: type.mime }, PRESIGN_TTL_SECONDS + 60);
  return { mode: "direct", url, headers, token, expiresInSeconds: PRESIGN_TTL_SECONDS };
}

/**
 * Step 3: the browser says it finished the PUT. The app re-checks permissions, then verifies what actually landed in
 * the bucket (exact size, real file type from the first bytes) before moving it out of quarantine and recording it.
 */
export async function completeUpload(actor: Actor, tokenStr: string) {
  const claim = parseUploadToken(tokenStr);
  if (!claim || claim.userId !== actor.id || !claim.key.startsWith(`pending/${actor.organizationId}/${claim.taskId}/`) || !storage.direct) {
    throw new TaskError("هذا الرفع غير صالح أو منتهٍ.");
  }
  await authorizeUpload(actor, claim.taskId, claim.kind, claim.commentId);
  const reject = async (message: string): Promise<never> => { await storage.remove(claim.key).catch(() => {}); throw new TaskError(message); };

  const actual = await storage.size(claim.key).catch(() => -1);
  if (actual < 0) throw new TaskError("لم يصل الملف. حاول مجدداً.");
  if (actual !== claim.size || actual > MAX_UPLOAD_BYTES) return reject("الملف المرفوع لا يطابق ما أُعلن عنه.");
  const chunks: Buffer[] = [];
  for await (const c of await storage.get(claim.key, { start: 0, end: 15 })) chunks.push(Buffer.from(c));
  const type = detectType(claim.fileName, new Uint8Array(Buffer.concat(chunks)));
  if (!type || type.mime !== claim.mime) return reject(UNSUPPORTED);

  const finalKey = `${actor.organizationId}/${claim.taskId}/${randomUUID()}.${extensionOf(claim.fileName)}`;
  await storage.direct.move(claim.key, finalKey);
  try {
    return await recordAttachment(actor, { taskId: claim.taskId, commentId: claim.commentId, fileName: claim.fileName, key: finalKey, mime: type.mime, kind: claim.kind, size: actual });
  } catch (e) {
    await storage.remove(finalKey).catch(() => {});
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
  if (!f) throw new TaskError("الملف غير موجود.");
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
