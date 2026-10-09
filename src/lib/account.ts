import { db } from "./db";
import { hashPassword, verifyPassword } from "./password";
import { logActivity } from "./activity";
import { MIN_PASSWORD } from "./password-reset";

export type ChangePasswordResult = { ok: true; sessionVersion: number } | { ok: false; reason: "wrong_password" | "weak" | "same" | "unavailable" };

/**
 * Changes the signed-in user's own password. Requires the current one, then bumps `sessionVersion`
 * so every other device is signed out; the caller re-issues the cookie for this device.
 */
export async function changePassword(userId: string, current: string, next: string): Promise<ChangePasswordResult> {
  if (next.length < MIN_PASSWORD || next.length > 200) return { ok: false, reason: "weak" };
  const user = await db.user.findFirst({ where: { id: userId, status: "ACTIVE", deletedAt: null } });
  if (!user) return { ok: false, reason: "unavailable" };
  if (!(await verifyPassword(current, user.passwordHash))) return { ok: false, reason: "wrong_password" };
  if (current === next) return { ok: false, reason: "same" };
  const passwordHash = await hashPassword(next);
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id: userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    await logActivity(tx, { organizationId: user.organizationId, actorId: userId, action: "user.password_changed" });
    return u;
  });
  return { ok: true, sessionVersion: updated.sessionVersion };
}
