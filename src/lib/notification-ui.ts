import type { NotificationType } from "@prisma/client";

export const NOTIFICATION_META: Record<NotificationType, { label: string; dot: string }> = {
  TASK_ASSIGNED: { label: "إسناد", dot: "bg-blue-500" },
  HANDOVER: { label: "تسليم", dot: "bg-indigo-500" },
  DEADLINE_APPROACHING: { label: "موعد نهائي", dot: "bg-amber-500" },
  TASK_OVERDUE: { label: "تأخير", dot: "bg-red-500" },
  REVISION_REQUESTED: { label: "تعديل", dot: "bg-orange-500" },
  TASK_APPROVED: { label: "موافقة", dot: "bg-green-500" },
  TASK_REJECTED: { label: "رفض", dot: "bg-red-500" },
  PUBLISHING_REMINDER: { label: "نشر", dot: "bg-teal-500" },
  MENTION: { label: "إشارة", dot: "bg-violet-500" },
  COMMENT: { label: "تعليق", dot: "bg-slate-400" },
};

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "الآن";
  if (s < 3600) return `قبل ${Math.floor(s / 60)} د`;
  if (s < 86400) return `قبل ${Math.floor(s / 3600)} س`;
  return `قبل ${Math.floor(s / 86400)} ي`;
}
