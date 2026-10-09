import type { NotificationType } from "@prisma/client";

export const NOTIFICATION_META: Record<NotificationType, { label: string; dot: string }> = {
  TASK_ASSIGNED: { label: "Assigned", dot: "bg-blue-500" },
  HANDOVER: { label: "Handover", dot: "bg-indigo-500" },
  DEADLINE_APPROACHING: { label: "Deadline", dot: "bg-amber-500" },
  TASK_OVERDUE: { label: "Overdue", dot: "bg-red-500" },
  REVISION_REQUESTED: { label: "Revision", dot: "bg-orange-500" },
  TASK_APPROVED: { label: "Approved", dot: "bg-green-500" },
  TASK_REJECTED: { label: "Rejected", dot: "bg-red-500" },
  PUBLISHING_REMINDER: { label: "Publishing", dot: "bg-teal-500" },
  MENTION: { label: "Mention", dot: "bg-violet-500" },
  COMMENT: { label: "Comment", dot: "bg-slate-400" },
};

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
