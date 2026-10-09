import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { env } from "./env";
import { logActivity } from "./activity";
import { ForbiddenError, can } from "./rbac";
import { TaskError, visibleTasksWhere, type Actor } from "./tasks";

/**
 * Share links are stateless signed tokens: base64url(JSON{t: taskId, v: version, e: expiry}) + "." + HMAC.
 * They expire on their own and are revoked all at once by bumping Task.briefShareVersion.
 */
const key = () => createHmac("sha256", env.sessionSecret).update("basma:brief-share:v1").digest();
const sign = (body: string) => createHmac("sha256", key()).update(body).digest("base64url");

export const MAX_SHARE_DAYS = 30;

export function makeToken(taskId: string, version: number, expiresAt: Date): string {
  const body = Buffer.from(JSON.stringify({ t: taskId, v: version, e: Math.floor(expiresAt.getTime() / 1000) })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function parseToken(token: string, now = Date.now()): { taskId: string; version: number } | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(body)), given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof p.t !== "string" || !Number.isInteger(p.v) || !Number.isInteger(p.e) || p.e * 1000 < now) return null;
    return { taskId: p.t, version: p.v };
  } catch {
    return null;
  }
}

function assertMayShare(actor: Actor, createdById: string) {
  if (!(can(actor.role, "task:edit:any") || (can(actor.role, "task:edit:own") && createdById === actor.id))) throw new ForbiddenError("Only the task's creator or a manager can share the brief.");
}

export async function createShareLink(actor: Actor, taskId: string, days: number) {
  const task = await db.task.findFirst({ where: { AND: [visibleTasksWhere(actor), { id: taskId }] } });
  if (!task) throw new TaskError("Task not found.");
  assertMayShare(actor, task.createdById);
  const d = Math.min(MAX_SHARE_DAYS, Math.max(1, Math.floor(days) || 7));
  const expiresAt = new Date(Date.now() + d * 864e5);
  await logActivity(db, { organizationId: actor.organizationId, actorId: actor.id, taskId, action: "brief.shared", meta: { days: d } });
  return { url: `${env.appUrl}/share/brief/${makeToken(taskId, task.briefShareVersion, expiresAt)}`, expiresAt };
}

export async function revokeShareLinks(actor: Actor, taskId: string) {
  const task = await db.task.findFirst({ where: { AND: [visibleTasksWhere(actor), { id: taskId }] } });
  if (!task) throw new TaskError("Task not found.");
  assertMayShare(actor, task.createdById);
  await db.task.update({ where: { id: taskId }, data: { briefShareVersion: { increment: 1 } } });
  await logActivity(db, { organizationId: actor.organizationId, actorId: actor.id, taskId, action: "brief.share_revoked" });
}

/** Returns the task scope for a valid, unexpired, unrevoked token. */
export async function resolveShareToken(token: string) {
  const p = parseToken(token);
  if (!p) return null;
  const t = await db.task.findFirst({ where: { id: p.taskId, deletedAt: null, briefShareVersion: p.version }, select: { id: true, organizationId: true } });
  return t ? { taskId: t.id, organizationId: t.organizationId } : null;
}
