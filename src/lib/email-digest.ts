import { db } from "./db";

export interface DigestOptions {
  send: (to: string, subject: string, text: string) => Promise<void>;
  enabled: boolean; // false when no SMTP is configured: nothing is sent and nothing is marked as sent
  appUrl: string;
  now?: Date;
  maxAgeHours?: number;
}

/** One email per person listing their new, still-unread notifications. Safe to run repeatedly. */
export async function sendPendingEmails(o: DigestOptions): Promise<{ emails: number; notifications: number; skipped?: "smtp" }> {
  if (!o.enabled) return { emails: 0, notifications: 0, skipped: "smtp" };
  const since = new Date((o.now ?? new Date()).getTime() - (o.maxAgeHours ?? 24) * 3600e3);
  const rows = await db.notification.findMany({
    where: { emailedAt: null, readAt: null, createdAt: { gte: since }, user: { emailNotifications: true, status: "ACTIVE", deletedAt: null }, OR: [{ taskId: null }, { task: { deletedAt: null } }] },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);

  let emails = 0, notifications = 0;
  for (const list of byUser.values()) {
    const u = list[0].user;
    const lines = list.map((n) => `• ${n.message}${n.taskId ? `\n  ${o.appUrl}/tasks/${n.taskId}` : ""}`);
    const subject = list.length === 1 ? list[0].message.slice(0, 120) : `${list.length} new notifications on BASMA MARKETING`;
    try {
      await o.send(u.email, subject, `Hi ${u.name},\n\n${lines.join("\n\n")}\n\nOpen BASMA MARKETING: ${o.appUrl}/notifications\n\nYou can turn these emails off on the Notifications page.`);
    } catch (e) {
      console.error(`[email-digest] failed for ${u.email}`, e);
      continue; // leave emailedAt null: retried on the next run while still fresh
    }
    await db.notification.updateMany({ where: { id: { in: list.map((n) => n.id) } }, data: { emailedAt: new Date() } });
    emails++; notifications += list.length;
  }
  return { emails, notifications };
}
