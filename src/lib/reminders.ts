import type { NotificationType, Prisma } from "@prisma/client";
import { db } from "./db";
import { formatDateTime } from "./datetime";

/**
 * Time-based notifications. Idempotent: every notification carries a dedupeKey, so running
 * this every few minutes never repeats itself, while changing a deadline/publish date earns a fresh one.
 */
export interface ReminderOptions {
  now?: Date;
  deadlineHours?: number; // "deadline approaching" window
  publishHours?: number; // "time to publish" window
  overdueDays?: number; // ignore deadlines that lapsed longer ago than this (avoids flooding on first run)
  timezone?: string;
}
export interface ReminderResult { approaching: number; overdue: number; publishing: number }

const OPEN_STAGES_EXCLUDED = ["SCHEDULED", "PUBLISHED", "COMPLETED"] as const;

type Draft = Prisma.NotificationCreateManyInput;

export async function runReminders(o: ReminderOptions = {}): Promise<ReminderResult> {
  const now = o.now ?? new Date();
  const tz = o.timezone ?? "Asia/Riyadh";
  const dh = o.deadlineHours ?? 24, ph = o.publishHours ?? 2, od = o.overdueDays ?? 30;
  const fmt = (d: Date) => formatDateTime(d, tz);
  const approaching: Draft[] = [], overdue: Draft[] = [], publishing: Draft[] = [];

  const draft = (t: { organizationId: string; id: string }, userId: string | null, type: NotificationType, message: string, key: string): Draft | null =>
    userId ? { organizationId: t.organizationId, userId, taskId: t.id, type, message, dedupeKey: key } : null;
  const push = (list: Draft[], d: Draft | null) => { if (d) list.push(d); };

  // 1) deadlines
  const withDeadline = await db.task.findMany({
    where: {
      deletedAt: null, stage: { notIn: [...OPEN_STAGES_EXCLUDED] },
      deadline: { gte: new Date(now.getTime() - od * 864e5), lte: new Date(now.getTime() + dh * 3600e3) },
    },
    select: { id: true, organizationId: true, taskCode: true, title: true, deadline: true, currentAssigneeId: true, createdById: true },
  });
  for (const t of withDeadline) {
    const when = t.deadline!;
    const stamp = when.getTime();
    const owner = t.currentAssigneeId ?? t.createdById;
    const label = `${t.taskCode}: ${t.title}`;
    if (when > now) {
      push(approaching, draft(t, owner, "DEADLINE_APPROACHING", `اقترب الموعد النهائي (${fmt(when)}): ${label}`, `deadline:${t.id}:${stamp}`));
    } else {
      const text = `المهمة متأخرة (كان موعدها ${fmt(when)}): ${label}`;
      for (const uid of new Set([owner, t.createdById])) push(overdue, draft(t, uid, "TASK_OVERDUE", text, `overdue:${t.id}:${stamp}`));
    }
  }

  // 2) scheduled content about to go live (or already past its time)
  const scheduled = await db.task.findMany({
    where: { deletedAt: null, stage: "SCHEDULED", publishAt: { lte: new Date(now.getTime() + ph * 3600e3), gte: new Date(now.getTime() - od * 864e5) } },
    select: { id: true, organizationId: true, taskCode: true, title: true, publishAt: true, currentAssigneeId: true, createdById: true },
  });
  for (const t of scheduled) {
    const when = t.publishAt!;
    const label = `${t.taskCode}: ${t.title}`;
    const due = when <= now;
    const text = due ? `فات موعد النشر (${fmt(when)}) — انشرها الآن: ${label}` : `النشر قريباً (${fmt(when)}): ${label}`;
    for (const uid of new Set([t.currentAssigneeId ?? t.createdById, t.createdById])) {
      push(publishing, draft(t, uid, "PUBLISHING_REMINDER", text, `${due ? "publish-due" : "publish"}:${t.id}:${when.getTime()}`));
    }
  }

  const create = async (rows: Draft[]) => (rows.length ? (await db.notification.createMany({ data: rows, skipDuplicates: true })).count : 0);
  return { approaching: await create(approaching), overdue: await create(overdue), publishing: await create(publishing) };
}
