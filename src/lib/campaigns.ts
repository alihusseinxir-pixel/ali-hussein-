import "server-only";
import type { Prisma, TaskStage } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { env } from "./env";
import { logActivity } from "./activity";
import { assertCan, can } from "./rbac";
import { parseLocalDateTime } from "./datetime";
import { summarize, type CampaignSummary } from "./campaign-stats";
import { TaskError, visibleTasksWhere, type Actor } from "./tasks";

const CLOSED: TaskStage[] = ["PUBLISHED", "COMPLETED"];

/** Managers see every campaign; others only campaigns that contain a task they may see. */
export function visibleCampaignsWhere(actor: Actor): Prisma.CampaignWhereInput {
  const base: Prisma.CampaignWhereInput = { organizationId: actor.organizationId, deletedAt: null };
  return can(actor.role, "task:view:all") ? base : { ...base, tasks: { some: visibleTasksWhere(actor) } };
}

/** Per-campaign progress computed from the tasks THIS user is allowed to see. */
export async function campaignSummaries(actor: Actor, campaignIds: string[]): Promise<Map<string, CampaignSummary>> {
  const out = new Map<string, CampaignSummary>();
  if (campaignIds.length === 0) return out;
  const where: Prisma.TaskWhereInput = { AND: [visibleTasksWhere(actor), { campaignId: { in: campaignIds } }] };
  const [grouped, late] = await Promise.all([
    db.task.groupBy({ by: ["campaignId", "stage"], where, _count: true }),
    db.task.groupBy({ by: ["campaignId"], where: { AND: [where, { deadline: { lt: new Date() }, stage: { notIn: CLOSED } }] }, _count: true }),
  ]);
  const lateBy = new Map(late.map((l) => [l.campaignId, l._count]));
  for (const id of campaignIds) {
    const counts: Partial<Record<TaskStage, number>> = {};
    for (const g of grouped) if (g.campaignId === id) counts[g.stage] = g._count;
    out.set(id, summarize(counts, lateBy.get(id) ?? 0));
  }
  return out;
}

export async function listBrandsWithCampaigns(actor: Actor) {
  const brands = await db.brand.findMany({
    where: { organizationId: actor.organizationId, deletedAt: null },
    orderBy: { name: "asc" },
    include: { campaigns: { where: visibleCampaignsWhere(actor), orderBy: { name: "asc" } } },
  });
  const summaries = await campaignSummaries(actor, brands.flatMap((b) => b.campaigns.map((c) => c.id)));
  // People who only see part of the organization should not see empty brand shells.
  const visible = can(actor.role, "task:view:all") ? brands : brands.filter((b) => b.campaigns.length > 0);
  return { brands: visible, summaries };
}

export async function getCampaign(actor: Actor, id: string) {
  const campaign = await db.campaign.findFirst({ where: { AND: [visibleCampaignsWhere(actor), { id }] }, include: { brand: true } });
  if (!campaign) return null;
  const tasks = await db.task.findMany({
    where: { AND: [visibleTasksWhere(actor), { campaignId: id }] },
    include: { currentAssignee: { select: { name: true } } },
    orderBy: [{ contentType: "asc" }, { createdAt: "asc" }],
  });
  const summary = (await campaignSummaries(actor, [id])).get(id)!;
  return { campaign, tasks, summary };
}

const update = z.object({
  name: z.string().trim().min(2, "الاسم حرفان على الأقل").max(100),
  description: z.string().trim().max(2000).optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
});

export async function updateCampaign(actor: Actor, id: string, raw: z.input<typeof update>) {
  assertCan(actor.role, "campaign:manage");
  const p = update.safeParse(raw);
  if (!p.success) throw new TaskError(p.error.issues[0].message);
  const c = await db.campaign.findFirst({ where: { id, organizationId: actor.organizationId, deletedAt: null } });
  if (!c) throw new TaskError("الحملة غير موجودة.");
  const date = (v?: string) => { if (!v) return null; const d = parseLocalDateTime(v, env.timezone); if (!d) throw new TaskError("التاريخ غير صالح."); return d; };
  const startDate = date(p.data.startDate), endDate = date(p.data.endDate);
  if (startDate && endDate && endDate < startDate) throw new TaskError("تاريخ النهاية يجب أن يكون بعد البداية.");
  const clash = await db.campaign.findFirst({ where: { organizationId: actor.organizationId, brandId: c.brandId, name: p.data.name, NOT: { id } } });
  if (clash) throw new TaskError("توجد حملة أخرى بهذا الاسم لنفس البراند.");
  await db.$transaction(async (tx) => {
    await tx.campaign.update({ where: { id }, data: { name: p.data.name, description: p.data.description || null, startDate, endDate } });
    await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, action: "campaign.updated", meta: { campaignId: id, name: p.data.name } });
  });
}

export async function archiveCampaign(actor: Actor, id: string) {
  assertCan(actor.role, "campaign:manage");
  const c = await db.campaign.findFirst({ where: { id, organizationId: actor.organizationId, deletedAt: null } });
  if (!c) throw new TaskError("الحملة غير موجودة.");
  const open = await db.task.count({ where: { campaignId: id, deletedAt: null, organizationId: actor.organizationId, stage: { notIn: CLOSED } } });
  if (open > 0) throw new TaskError(`ما زال هناك ${open} مهمة قيد التنفيذ. أنهِها أو انقلها أولاً.`);
  await db.$transaction(async (tx) => {
    await tx.campaign.update({ where: { id }, data: { deletedAt: new Date() } });
    await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, action: "campaign.archived", meta: { campaignId: id, name: c.name } });
  });
}

export async function archiveBrand(actor: Actor, id: string) {
  assertCan(actor.role, "campaign:manage");
  const b = await db.brand.findFirst({ where: { id, organizationId: actor.organizationId, deletedAt: null } });
  if (!b) throw new TaskError("البراند غير موجود.");
  if (await db.campaign.count({ where: { brandId: id, deletedAt: null } })) throw new TaskError("أرشف حملات البراند أولاً.");
  await db.$transaction(async (tx) => {
    await tx.brand.update({ where: { id }, data: { deletedAt: new Date() } });
    await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, action: "brand.archived", meta: { brandId: id, name: b.name } });
  });
}
