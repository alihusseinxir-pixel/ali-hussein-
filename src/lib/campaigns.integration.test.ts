import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { createTask, type Actor } from "./tasks";
import { archiveBrand, archiveCampaign, campaignSummaries, getCampaign, listBrandsWithCampaigns, updateCampaign } from "./campaigns";
import { taskInputSchema } from "./task-schema";
import { ForbiddenError } from "./rbac";

const tag = `cm${Date.now()}`;
let orgA: string, orgB: string;
let sm: Actor, video: Actor, video2: Actor, outsider: Actor;
let brandId: string, campA: string, campB: string;
const input = (o: Record<string, unknown>) => taskInputSchema.parse({ title: "Content", contentType: "REEL", allowDuplicate: "1", ...o });

async function user(org: string, role: Actor["role"], n: string): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: org, name: n, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: org, role };
}
beforeAll(async () => {
  orgA = (await db.organization.create({ data: { name: "CA", slug: `cma-${tag}` } })).id;
  orgB = (await db.organization.create({ data: { name: "CB", slug: `cmb-${tag}` } })).id;
  sm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm");
  video = await user(orgA, "VIDEOGRAPHER", "video");
  video2 = await user(orgA, "VIDEOGRAPHER", "video2");
  outsider = await user(orgB, "ADMIN", "out");
  brandId = (await db.brand.create({ data: { organizationId: orgA, name: "TAZAJ" } })).id;
  campA = (await db.campaign.create({ data: { organizationId: orgA, brandId, name: "Fresh With You" } })).id;
  campB = (await db.campaign.create({ data: { organizationId: orgA, brandId, name: "Ramadan" } })).id;
});
afterAll(async () => {
  for (const org of [orgA, orgB]) {
    await db.calendarEvent.deleteMany({ where: { organizationId: org } });
    await db.activityLog.deleteMany({ where: { organizationId: org } });
    await db.notification.deleteMany({ where: { organizationId: org } });
    await db.task.deleteMany({ where: { organizationId: org } });
    await db.taskCounter.deleteMany({ where: { organizationId: org } });
    await db.campaign.deleteMany({ where: { organizationId: org } });
    await db.brand.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { organizationId: org } });
    await db.organization.delete({ where: { id: org } });
  }
  await db.$disconnect();
});

describe("campaigns (integration)", () => {
  it("summarises progress per campaign", async () => {
    await createTask(sm, input({ campaignId: campA }));
    await createTask(sm, input({ campaignId: campA, assigneeId: video.id, deadline: "2020-01-01T10:00" }));
    const done = await createTask(sm, input({ campaignId: campA }));
    await db.task.update({ where: { id: done.id }, data: { stage: "PUBLISHED" } });
    const s = (await campaignSummaries(sm, [campA, campB])).get(campA)!;
    expect(s).toMatchObject({ total: 3, done: 1, percent: 33, overdue: 1 });
    expect(s.buckets.planning).toBe(2);
    expect((await campaignSummaries(sm, [campA, campB])).get(campB)?.total).toBe(0);
  });

  it("shows production people only the campaigns and counts they are involved in", async () => {
    const mine = await listBrandsWithCampaigns(video);
    expect(mine.brands.flatMap((b) => b.campaigns.map((c) => c.id))).toEqual([campA]); // Ramadan has nothing of theirs
    expect(mine.summaries.get(campA)?.total).toBe(1); // only their own task, not the other two
    const none = await listBrandsWithCampaigns(video2);
    expect(none.brands).toHaveLength(0);
    const all = await listBrandsWithCampaigns(sm);
    expect(all.brands[0].campaigns.map((c) => c.id).sort()).toEqual([campA, campB].sort());
  });

  it("guards campaign pages by visibility and organization", async () => {
    expect(await getCampaign(sm, campA)).not.toBeNull();
    expect((await getCampaign(video, campA))?.tasks).toHaveLength(1);
    expect(await getCampaign(video, campB)).toBeNull();
    expect(await getCampaign(video2, campA)).toBeNull();
    expect(await getCampaign(outsider, campA)).toBeNull();
  });

  it("validates edits (permissions, names, dates) and logs them", async () => {
    await expect(updateCampaign(video, campA, { name: "Hacked" })).rejects.toThrow(ForbiddenError);
    await expect(updateCampaign(outsider, campA, { name: "Hacked" })).rejects.toThrow(/not found/i);
    await expect(updateCampaign(sm, campA, { name: "Ramadan" })).rejects.toThrow(/already has this name/);
    await expect(updateCampaign(sm, campA, { name: "Fresh", startDate: "2026-10-10T10:00", endDate: "2026-10-01T10:00" })).rejects.toThrow(/end date/);
    await updateCampaign(sm, campA, { name: "Fresh With You 2", description: "Autumn push", startDate: "2026-10-01T00:00", endDate: "2026-12-31T00:00" });
    const c = await db.campaign.findUniqueOrThrow({ where: { id: campA } });
    expect(c.name).toBe("Fresh With You 2");
    expect(c.endDate?.toISOString()).toBe("2026-12-30T21:00:00.000Z"); // 00:00 Riyadh
    expect(await db.activityLog.count({ where: { organizationId: orgA, action: "campaign.updated" } })).toBe(1);
  });

  it("archives only when nothing is in progress, and brands only when empty", async () => {
    await expect(archiveCampaign(sm, campA)).rejects.toThrow(/still in progress/);
    await expect(archiveBrand(sm, brandId)).rejects.toThrow(/campaigns first/);
    await archiveCampaign(sm, campB); // empty campaign
    expect(await getCampaign(sm, campB)).toBeNull();
    await db.task.updateMany({ where: { campaignId: campA }, data: { stage: "COMPLETED" } });
    await archiveCampaign(sm, campA);
    await archiveBrand(sm, brandId);
    expect((await listBrandsWithCampaigns(sm)).brands).toHaveLength(0);
    await expect(archiveCampaign(video, campA)).rejects.toThrow(ForbiddenError);
  });
});
