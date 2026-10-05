import type { ApprovalStatus, ContentType, TaskStage } from "@prisma/client";
import { addDays, dayKey, weekday } from "./calendar";

/**
 * Analytics maths — pure functions over plain rows (no DB), so every definition is unit-tested.
 *
 * Definitions
 *  - completed:   the task was handed to PUBLISHED/COMPLETED (time = that handover). Time to publish = createdAt → completed.
 *  - delivery:    a person received a task into ASSIGNED/PRODUCTION/EDITING and later handed it forward from PRODUCTION/EDITING.
 *                 Delivery time = receipt → hand-forward. Reassignments abort the interval (nobody is credited).
 *  - revision:    a handover that sends work BACK from a review/approval stage to PRODUCTION/EDITING; charged to the receiver.
 *  - revision rate (org):    reviewed tasks that were sent back at least once ÷ tasks that entered review, in range.
 *  - revision rate (person): revisions received ÷ deliveries, in range.
 *  - approval time: a reviewer's decision (approve / request changes) minus when the task reached that stage.
 *  - overdue:     open task (not published/completed) with a deadline in the past — a snapshot, not range-bound.
 */

export interface ATask { id: string; contentType: ContentType; stage: TaskStage; createdAt: Date; deadline: Date | null; campaignId: string | null; currentAssigneeId: string | null }
export interface AHandoff { taskId: string; fromUserId: string; toUserId: string; fromStage: TaskStage; toStage: TaskStage; createdAt: Date }
export interface AApproval { taskId: string; approverId: string; stage: TaskStage; status: ApprovalStatus; createdAt: Date }
export interface Range { from: Date; to: Date } // [from, to)

const HOUR = 3600e3, DAY = 864e5;
export const CLOSED: TaskStage[] = ["PUBLISHED", "COMPLETED"];
const REVIEW: TaskStage[] = ["PRODUCTION_REVIEW", "EDITING_REVIEW", "INTERNAL_APPROVAL", "SOCIAL_APPROVAL"];
const WORK: TaskStage[] = ["PRODUCTION", "EDITING"];
const ENTRY: TaskStage[] = ["ASSIGNED", "PRODUCTION", "EDITING"];

const inRange = (d: Date, r: Range) => d >= r.from && d < r.to;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (n: number | null, dp = 1) => (n === null ? null : Math.round(n * 10 ** dp) / 10 ** dp);

function byTask(hs: AHandoff[]) {
  const m = new Map<string, AHandoff[]>();
  for (const h of hs) m.set(h.taskId, [...(m.get(h.taskId) ?? []), h]);
  for (const list of m.values()) list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return m;
}

export function completionTimes(handoffs: AHandoff[]): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const h of handoffs) {
    if (CLOSED.includes(h.toStage) && (!out.has(h.taskId) || h.createdAt < out.get(h.taskId)!)) out.set(h.taskId, h.createdAt);
  }
  return out;
}

export interface Delivery { taskId: string; userId: string; stage: TaskStage; start: Date; end: Date; hours: number }

export function deliveries(handoffs: AHandoff[]): Delivery[] {
  const out: Delivery[] = [];
  for (const list of byTask(handoffs).values()) {
    list.forEach((h, i) => {
      const next = list[i + 1];
      if (!next || !ENTRY.includes(h.toStage)) return;
      const forward = next.fromUserId === h.toUserId && WORK.includes(next.fromStage) && next.toStage !== next.fromStage && !isRevision(next);
      if (forward) out.push({ taskId: h.taskId, userId: h.toUserId, stage: next.fromStage, start: h.createdAt, end: next.createdAt, hours: (next.createdAt.getTime() - h.createdAt.getTime()) / HOUR });
    });
  }
  return out;
}

// Exactly the backward loops of the workflow (see revisionTarget in workflow.ts). PRODUCTION_REVIEW → EDITING is a forward approval.
const REVISION_PAIRS: [TaskStage, TaskStage][] = [["PRODUCTION_REVIEW", "PRODUCTION"], ["EDITING_REVIEW", "EDITING"], ["INTERNAL_APPROVAL", "EDITING"], ["SOCIAL_APPROVAL", "EDITING"]];
export const isRevision = (h: Pick<AHandoff, "fromStage" | "toStage">) => REVISION_PAIRS.some(([f, t]) => h.fromStage === f && h.toStage === t);

export interface ApprovalTime { approverId: string; stage: TaskStage; status: ApprovalStatus; at: Date; hours: number }

export function approvalTimes(approvals: AApproval[], handoffs: AHandoff[]): ApprovalTime[] {
  const per = byTask(handoffs);
  const out: ApprovalTime[] = [];
  for (const a of approvals) {
    const entered = (per.get(a.taskId) ?? []).filter((h) => h.toStage === a.stage && h.createdAt <= a.createdAt).pop();
    if (entered) out.push({ approverId: a.approverId, stage: a.stage, status: a.status, at: a.createdAt, hours: (a.createdAt.getTime() - entered.createdAt.getTime()) / HOUR });
  }
  return out;
}

export interface Overview {
  created: number; completed: number; open: number; overdue: number;
  avgDaysToPublish: number | null; avgApprovalHours: number | null; revisionRate: number | null; reviewed: number; revised: number;
}

export function overview(tasks: ATask[], handoffs: AHandoff[], approvals: AApproval[], range: Range, now: Date): Overview {
  const done = completionTimes(handoffs);
  const completedInRange = tasks.filter((t) => done.has(t.id) && inRange(done.get(t.id)!, range));
  const open = tasks.filter((t) => !CLOSED.includes(t.stage));
  const reviewedIds = new Set(handoffs.filter((h) => REVIEW.includes(h.toStage) && inRange(h.createdAt, range)).map((h) => h.taskId));
  const revisedIds = new Set(handoffs.filter((h) => isRevision(h) && inRange(h.createdAt, range)).map((h) => h.taskId));
  for (const id of revisedIds) reviewedIds.add(id); // a task sent back must have been under review
  return {
    created: tasks.filter((t) => inRange(t.createdAt, range)).length,
    completed: completedInRange.length,
    open: open.length,
    overdue: open.filter((t) => t.deadline && t.deadline < now).length,
    avgDaysToPublish: round(mean(completedInRange.map((t) => (done.get(t.id)!.getTime() - t.createdAt.getTime()) / DAY))),
    avgApprovalHours: round(mean(approvalTimes(approvals, handoffs).filter((a) => inRange(a.at, range)).map((a) => a.hours))),
    reviewed: reviewedIds.size, revised: revisedIds.size,
    revisionRate: reviewedIds.size ? Math.round((revisedIds.size / reviewedIds.size) * 100) : null,
  };
}

// ───────── volume over time ─────────

export type Granularity = "week" | "month";
export interface Bucket { key: string; label: string; created: number; published: number }

function bucketKey(d: Date, g: Granularity, tz: string, weekStart: number): string {
  const k = dayKey(d, tz);
  if (g === "month") return k.slice(0, 7);
  return addDays(k, -((weekday(k) - weekStart + 7) % 7));
}

export function volumeSeries(tasks: ATask[], handoffs: AHandoff[], range: Range, g: Granularity, tz: string, weekStart: number): Bucket[] {
  const buckets = new Map<string, Bucket>();
  const label = (key: string) => g === "month"
    ? new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" })
    : new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  // pre-fill every bucket in the range so empty periods show as zero, not as gaps
  for (let t = range.from.getTime(); t < range.to.getTime(); t += DAY) {
    const k = bucketKey(new Date(t), g, tz, weekStart);
    if (!buckets.has(k)) buckets.set(k, { key: k, label: label(k), created: 0, published: 0 });
  }
  const touch = (d: Date, field: "created" | "published") => { if (inRange(d, range)) { const b = buckets.get(bucketKey(d, g, tz, weekStart)); if (b) b[field]++; } };
  for (const t of tasks) touch(t.createdAt, "created");
  for (const [, at] of completionTimes(handoffs)) touch(at, "published");
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function byContentType(tasks: ATask[], handoffs: AHandoff[], range: Range) {
  const done = completionTimes(handoffs);
  const m = new Map<ContentType, { type: ContentType; created: number; published: number }>();
  for (const t of tasks) {
    const row = m.get(t.contentType) ?? { type: t.contentType, created: 0, published: 0 };
    if (inRange(t.createdAt, range)) row.created++;
    if (done.has(t.id) && inRange(done.get(t.id)!, range)) row.published++;
    m.set(t.contentType, row);
  }
  return [...m.values()].filter((r) => r.created || r.published).sort((a, b) => b.created - a.created || b.published - a.published);
}

// ───────── people & campaigns ─────────

export interface PersonStats {
  userId: string; open: number; overdue: number; delivered: number; avgDeliveryHours: number | null;
  revisionsReceived: number; revisionRate: number | null; approvalsGiven: number; avgApprovalHours: number | null;
}

export function peopleStats(userIds: string[], tasks: ATask[], handoffs: AHandoff[], approvals: AApproval[], range: Range, now: Date): PersonStats[] {
  const ds = deliveries(handoffs).filter((d) => inRange(d.end, range));
  const revs = handoffs.filter((h) => isRevision(h) && inRange(h.createdAt, range));
  const aps = approvalTimes(approvals, handoffs).filter((a) => inRange(a.at, range));
  return userIds.map((id) => {
    const mine = ds.filter((d) => d.userId === id);
    const owned = tasks.filter((t) => t.currentAssigneeId === id && !CLOSED.includes(t.stage));
    const revisionsReceived = revs.filter((h) => h.toUserId === id).length;
    const decided = aps.filter((a) => a.approverId === id);
    return {
      userId: id, open: owned.length, overdue: owned.filter((t) => t.deadline && t.deadline < now).length,
      delivered: mine.length, avgDeliveryHours: round(mean(mine.map((d) => d.hours))),
      revisionsReceived, revisionRate: mine.length ? Math.round((revisionsReceived / mine.length) * 100) : null,
      approvalsGiven: decided.length, avgApprovalHours: round(mean(decided.map((a) => a.hours))),
    };
  });
}

export interface CampaignStats { campaignId: string; total: number; published: number; percent: number; overdue: number; avgDaysToPublish: number | null; revisionRate: number | null }

/** Lifetime figures per campaign (not range-bound). */
export function campaignStats(campaignIds: string[], tasks: ATask[], handoffs: AHandoff[], now: Date): CampaignStats[] {
  const done = completionTimes(handoffs);
  return campaignIds.map((id) => {
    const ts = tasks.filter((t) => t.campaignId === id);
    const ids = new Set(ts.map((t) => t.id));
    const hs = handoffs.filter((h) => ids.has(h.taskId));
    const finished = ts.filter((t) => done.has(t.id));
    const reviewed = new Set(hs.filter((h) => REVIEW.includes(h.toStage)).map((h) => h.taskId));
    const revised = new Set(hs.filter(isRevision).map((h) => h.taskId));
    revised.forEach((t) => reviewed.add(t));
    const published = ts.filter((t) => CLOSED.includes(t.stage)).length;
    return {
      campaignId: id, total: ts.length, published, percent: ts.length ? Math.round((published / ts.length) * 100) : 0,
      overdue: ts.filter((t) => !CLOSED.includes(t.stage) && t.deadline && t.deadline < now).length,
      avgDaysToPublish: round(mean(finished.map((t) => (done.get(t.id)!.getTime() - t.createdAt.getTime()) / DAY))),
      revisionRate: reviewed.size ? Math.round((revised.size / reviewed.size) * 100) : null,
    };
  });
}

export function formatDuration(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${round(hours)} h`;
  return `${round(hours / 24)} d`;
}
