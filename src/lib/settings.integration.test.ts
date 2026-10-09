import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { createTask, type Actor } from "./tasks";
import { taskInputSchema } from "./task-schema";
import { archiveBrand } from "./campaigns";
import { createBrand, listBrandsForSettings, restoreBrand, updateBrand, updateOrganizationName } from "./settings";
import { PERMISSIONS, ROLE_PERMISSIONS } from "./rbac";
import { AR_PERMISSION, AR_ROLE } from "./i18n/ar";

const tag = `st${Date.now()}`;
let orgA: string, orgB: string;
let admin: Actor, mm: Actor, sm: Actor, video: Actor, outsider: Actor;

async function user(org: string, role: Actor["role"], n: string): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: org, name: n, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: org, role };
}
beforeAll(async () => {
  orgA = (await db.organization.create({ data: { name: "SA", slug: `sta-${tag}` } })).id;
  orgB = (await db.organization.create({ data: { name: "SB", slug: `stb-${tag}` } })).id;
  admin = await user(orgA, "ADMIN", "admin");
  mm = await user(orgA, "MARKETING_MANAGER", "mm");
  sm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm");
  video = await user(orgA, "VIDEOGRAPHER", "video");
  outsider = await user(orgB, "ADMIN", "out");
});
afterAll(async () => {
  for (const org of [orgA, orgB]) {
    await db.activityLog.deleteMany({ where: { organizationId: org } });
    await db.task.deleteMany({ where: { organizationId: org } });
    await db.taskCounter.deleteMany({ where: { organizationId: org } });
    await db.campaign.deleteMany({ where: { organizationId: org } });
    await db.brand.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { organizationId: org } });
    await db.organization.delete({ where: { id: org } });
  }
  await db.$disconnect();
});

describe("brand settings", () => {
  let brandId: string;
  it("managers create brands; others cannot; names are unique per organization, case-insensitively", async () => {
    brandId = (await createBrand(mm, { name: "  Tazaj ", guidelinesUrl: "https://example.com/brand.pdf" })).id;
    expect((await db.brand.findUniqueOrThrow({ where: { id: brandId } })).name).toBe("Tazaj");
    await expect(createBrand(sm, { name: "tazaj" })).rejects.toThrow(/بنفس الاسم/);
    await expect(createBrand(video, { name: "Nope" })).rejects.toThrow();
    await expect(createBrand(outsider, { name: "Tazaj" })).resolves.toBeTruthy(); // another organization is independent
  });
  it("validates name and only accepts http(s) guideline links", async () => {
    await expect(createBrand(mm, { name: "x" })).rejects.toThrow(/حرفان/);
    await expect(createBrand(mm, { name: "Bad", guidelinesUrl: "javascript:alert(1)" })).rejects.toThrow(/http/);
    await expect(createBrand(mm, { name: "Bad2", guidelinesUrl: "ftp://x" })).rejects.toThrow(/http/);
  });
  it("renames and edits, rejecting clashes and cross-organization access", async () => {
    const other = (await createBrand(mm, { name: "Other" })).id;
    await updateBrand(sm, brandId, { name: "Tazaj Sports", guidelinesUrl: "" });
    const b = await db.brand.findUniqueOrThrow({ where: { id: brandId } });
    expect([b.name, b.guidelinesUrl]).toEqual(["Tazaj Sports", null]);
    await expect(updateBrand(mm, other, { name: "tazaj sports" })).rejects.toThrow(/بنفس الاسم/);
    await expect(updateBrand(outsider, brandId, { name: "Hijack" })).rejects.toThrow(/غير موجود/);
    await expect(updateBrand(video, brandId, { name: "Hijack" })).rejects.toThrow();
  });
  it("archives only without active campaigns, keeps its tasks, and can restore; archived names stay reserved", async () => {
    const camp = await db.campaign.create({ data: { organizationId: orgA, brandId, name: "Ramadan" } });
    await expect(archiveBrand(mm, brandId)).rejects.toThrow();
    await db.campaign.update({ where: { id: camp.id }, data: { deletedAt: new Date() } });
    const t = await createTask(mm, taskInputSchema.parse({ title: "Keeps brand", contentType: "REEL", brandId }));
    await archiveBrand(mm, brandId);
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).brandId).toBe(brandId);
    const lists = await listBrandsForSettings(mm);
    expect(lists.archived.map((x) => x.id)).toContain(brandId);
    expect(lists.active.map((x) => x.id)).not.toContain(brandId);
    await expect(createBrand(mm, { name: "Tazaj Sports" })).rejects.toThrow(/مؤرشف/);
    await expect(restoreBrand(video, brandId)).rejects.toThrow();
    await expect(restoreBrand(outsider, brandId)).rejects.toThrow(/غير موجود/);
    await restoreBrand(mm, brandId);
    expect((await listBrandsForSettings(mm)).active.find((x) => x.id === brandId)?._count.tasks).toBe(1);
  });
  it("records brand changes in the audit trail", async () => {
    const actions = (await db.activityLog.findMany({ where: { organizationId: orgA, action: { startsWith: "brand." } } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["brand.created", "brand.updated", "brand.archived", "brand.restored"]));
  });
});

describe("organization settings", () => {
  it("only an admin renames the organization", async () => {
    await updateOrganizationName(admin, "  وكالة بصمة ");
    expect((await db.organization.findUniqueOrThrow({ where: { id: orgA } })).name).toBe("وكالة بصمة");
    await expect(updateOrganizationName(mm, "x y")).rejects.toThrow();
    await expect(updateOrganizationName(admin, "a")).rejects.toThrow(/بين 2/);
    expect((await db.organization.findUniqueOrThrow({ where: { id: orgB } })).name).toBe("SB"); // untouched
    expect(await db.activityLog.count({ where: { organizationId: orgA, action: "org.renamed" } })).toBe(1);
  });
});

describe("permission matrix data", () => {
  it("has an Arabic label for every permission and role", () => {
    for (const p of PERMISSIONS) expect(AR_PERMISSION[p]).toBeTruthy();
    for (const r of Object.keys(ROLE_PERMISSIONS)) expect(AR_ROLE[r as keyof typeof AR_ROLE]).toBeTruthy();
  });
});
