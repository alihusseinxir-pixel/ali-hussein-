import "server-only";
import type { Role } from "@prisma/client";
import { db } from "./db";
import { env } from "./env";
import { can } from "./rbac";
import { addDays, dayKey } from "./calendar";
import { parseLocalDateTime } from "./datetime";
import {
  byContentType, campaignStats, overview, peopleStats, volumeSeries,
  type CampaignStats, type Granularity, type Overview, type PersonStats, type Bucket,
} from "./analytics-calc";
import type { Actor } from "./tasks";

export const RANGES = {
  "30": { days: 30, label: "30 days", phrase: "the last 30 days", g: "week" },
  "90": { days: 90, label: "90 days", phrase: "the last 90 days", g: "week" },
  "365": { days: 365, label: "12 months", phrase: "the last 12 months", g: "month" },
} as const;
export type RangeKey = keyof typeof RANGES;
export const parseRange = (v: string | undefined): RangeKey => (v && v in RANGES ? (v as RangeKey) : "30");

const PRODUCTION_ROLES: Role[] = ["VIDEOGRAPHER", "PHOTOGRAPHER", "VIDEO_EDITOR", "DESIGNER"];

export interface PersonRow extends PersonStats { name: string; role: Role }
export interface CampaignRow extends CampaignStats { name: string; brand: string }

export type Analytics =
  | { scope: "org"; range: RangeKey; overview: Overview; series: Bucket[]; granularity: Granularity; byType: ReturnType<typeof byContentType>; people: PersonRow[]; campaigns: CampaignRow[] }
  | { scope: "self"; range: RangeKey; me: PersonRow };

/**
 * Loads the organization's rows once and delegates to the pure calculators in analytics-calc.ts.
 * Organization-wide numbers only go to roles with analytics:view:all; everybody else gets just their own row.
 * (Rows are aggregated in memory — fine for a marketing department; move to SQL aggregates if volumes grow into the hundreds of thousands.)
 */
export async function loadAnalytics(actor: Actor, key: RangeKey, now = new Date()): Promise<Analytics> {
  const tz = env.timezone;
  const { days, g } = RANGES[key];
  const today = dayKey(now, tz);
  const range = { from: parseLocalDateTime(addDays(today, -(days - 1)), tz)!, to: parseLocalDateTime(addDays(today, 1), tz)! };
  const org = { organizationId: actor.organizationId };
  const taskScope = { ...org, deletedAt: null };

  const [tasks, handoffs, approvals, users, campaigns] = await Promise.all([
    db.task.findMany({ where: taskScope, select: { id: true, contentType: true, stage: true, createdAt: true, deadline: true, campaignId: true, currentAssigneeId: true } }),
    db.taskHandoff.findMany({ where: { task: taskScope }, select: { taskId: true, fromUserId: true, toUserId: true, fromStage: true, toStage: true, createdAt: true } }),
    db.taskApproval.findMany({ where: { task: taskScope }, select: { taskId: true, approverId: true, stage: true, status: true, createdAt: true } }),
    db.user.findMany({ where: { ...org, deletedAt: null, status: "ACTIVE" }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
    db.campaign.findMany({ where: { ...org, deletedAt: null }, select: { id: true, name: true, brand: { select: { name: true } } }, orderBy: { name: "asc" } }),
  ]);

  const stats = peopleStats(users.map((u) => u.id), tasks, handoffs, approvals, range, now);
  const rows: PersonRow[] = stats.map((s) => ({ ...s, name: users.find((u) => u.id === s.userId)!.name, role: users.find((u) => u.id === s.userId)!.role }));

  if (!can(actor.role, "analytics:view:all")) {
    return { scope: "self", range: key, me: rows.find((r) => r.userId === actor.id)! };
  }
  const active = (r: PersonRow) => PRODUCTION_ROLES.includes(r.role) || r.delivered + r.open + r.approvalsGiven + r.revisionsReceived > 0;
  const camp = campaignStats(campaigns.map((c) => c.id), tasks, handoffs, now);
  return {
    scope: "org", range: key, granularity: g,
    overview: overview(tasks, handoffs, approvals, range, now),
    series: volumeSeries(tasks, handoffs, range, g, tz, env.weekStart),
    byType: byContentType(tasks, handoffs, range),
    people: rows.filter(active).sort((a, b) => b.delivered - a.delivered || a.name.localeCompare(b.name)),
    campaigns: camp.map((c) => ({ ...c, name: campaigns.find((x) => x.id === c.campaignId)!.name, brand: campaigns.find((x) => x.id === c.campaignId)!.brand.name }))
      .filter((c) => c.total > 0).sort((a, b) => b.total - a.total),
  };
}
