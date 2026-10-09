import { AR_ROLE } from "./i18n/ar";
import type { Role } from "@prisma/client";

/**
 * Arabic plain-text emails. Pure (no I/O) so the wording is testable. Each link sits on its own line so that mail
 * clients keep it intact (and left-to-right) inside right-to-left text, and tests can pull tokens out of it.
 */
export interface Mail { subject: string; text: string }
const APP = "BASMA MARKETING";

export function inviteEmail(o: { name: string; inviter: string; organization: string; role: Role; link: string; validDays?: number }): Mail {
  const days = o.validDays ?? 7;
  return {
    subject: `دعوة للانضمام إلى ${o.organization} على ${APP}`,
    text: `مرحباً ${o.name}،\n\nدعاك ${o.inviter} للانضمام إلى ${o.organization} بدور ${AR_ROLE[o.role]}.\n\nلقبول الدعوة (صالحة لمدة ${days === 7 ? "7 أيام" : `${days} يوماً`}) افتح هذا الرابط:\n${o.link}\n`,
  };
}

export function passwordResetEmail(o: { name: string; link: string }): Mail {
  return {
    subject: `استعادة كلمة المرور في ${APP}`,
    text: `مرحباً ${o.name}،\n\nطلب أحدهم استعادة كلمة المرور لهذا الحساب. إن كنت أنت، فاختر كلمة مرور جديدة من هذا الرابط (صالح لمدة ساعة واحدة ويُستخدم مرة واحدة):\n${o.link}\n\nإن لم تكن أنت، فتجاهل هذه الرسالة — لم تتغير كلمة مرورك.`,
  };
}

/** Arabic count agreement: 2 → dual, 3–10 → plural, 11+ → singular accusative. */
export function newNotificationsPhrase(n: number): string {
  if (n === 1) return "إشعار جديد";
  if (n === 2) return "إشعاران جديدان";
  if (n <= 10) return `${n} إشعارات جديدة`;
  return `${n} إشعاراً جديداً`;
}

export function digestEmail(o: { name: string; items: { message: string; url: string | null }[]; appUrl: string }): Mail {
  const lines = o.items.map((n) => `• ${n.message}${n.url ? `\n${n.url}` : ""}`);
  return {
    subject: o.items.length === 1 ? o.items[0].message.slice(0, 120) : `${newNotificationsPhrase(o.items.length)} في ${APP}`,
    text: `مرحباً ${o.name}،\n\n${lines.join("\n\n")}\n\nافتح ${APP}:\n${o.appUrl}/notifications\n\nيمكنك إيقاف هذه الرسائل من صفحة الإشعارات.`,
  };
}
