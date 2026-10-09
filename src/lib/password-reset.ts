import { randomBytes } from "node:crypto";
import { db } from "./db";
import { hashPassword } from "./password";
import { hashToken } from "./tokens";
import { logActivity } from "./activity";
import { passwordResetEmail } from "./email-templates";

export const RESET_TTL_MS = 60 * 60_000; // 1 hour
export const MIN_PASSWORD = 10;

/**
 * Starts a reset. Always resolves the same way whether or not the email exists, so the form
 * cannot be used to discover who has an account.
 */
export async function requestPasswordReset(email: string, o: { send: (to: string, subject: string, text: string) => Promise<void>; appUrl: string; now?: Date }) {
  const user = await db.user.findFirst({ where: { email: email.trim().toLowerCase(), status: "ACTIVE", deletedAt: null } });
  if (!user) return;
  const now = o.now ?? new Date();
  const token = randomBytes(32).toString("base64url");
  await db.$transaction(async (tx) => {
    await tx.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }); // only the newest link works
    await tx.passwordReset.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + RESET_TTL_MS) } });
    await logActivity(tx, { organizationId: user.organizationId, actorId: user.id, action: "user.password_reset_requested" });
  });
  const mail = passwordResetEmail({ name: user.name, link: `${o.appUrl}/reset-password/${token}` });
  await o.send(user.email, mail.subject, mail.text);
}

export async function isResetTokenValid(token: string, now = new Date()) {
  const r = await db.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } });
  return !!r && !r.usedAt && r.expiresAt > now;
}

export type ResetResult = "ok" | "invalid" | "weak";

export async function resetPassword(token: string, newPassword: string, now = new Date()): Promise<ResetResult> {
  if (newPassword.length < MIN_PASSWORD || newPassword.length > 200) return "weak";
  const r = await db.passwordReset.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!r || r.usedAt || r.expiresAt <= now || r.user.status !== "ACTIVE" || r.user.deletedAt) return "invalid";
  const passwordHash = await hashPassword(newPassword);
  return db.$transaction(async (tx) => {
    // Claim the token atomically: a link can only ever be used once, even under concurrent requests.
    const claimed = await tx.passwordReset.updateMany({ where: { id: r.id, usedAt: null }, data: { usedAt: now } });
    if (claimed.count === 0) return "invalid" as const;
    await tx.passwordReset.updateMany({ where: { userId: r.userId, usedAt: null }, data: { usedAt: now } });
    await tx.user.update({ where: { id: r.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } }); // signs out every device
    await logActivity(tx, { organizationId: r.user.organizationId, actorId: r.userId, action: "user.password_reset" });
    return "ok" as const;
  });
}
