import "server-only";
import { z } from "zod";
import { db } from "./db";
import { logActivity } from "./activity";
import { assertCan } from "./rbac";
import { TaskError, type Actor } from "./tasks";

export const brandSchema = z.object({
  name: z.string().trim().min(2, "اسم البراند حرفان على الأقل").max(100, "اسم البراند 100 حرف كحد أقصى"),
  // only http(s) links are stored, so a guidelines link can never be a javascript: URL
  guidelinesUrl: z.string().trim().max(1000).optional().transform((v) => (v ? v : null))
    .refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "رابط الإرشادات يجب أن يبدأ بـ http:// أو https://"),
});
export type BrandInput = z.input<typeof brandSchema>;

function parse(input: BrandInput) {
  const r = brandSchema.safeParse(input);
  if (!r.success) throw new TaskError(r.error.issues[0].message);
  return r.data;
}

export async function listBrandsForSettings(a: Actor) {
  const org = { organizationId: a.organizationId };
  const [active, archived] = await Promise.all([
    db.brand.findMany({ where: { ...org, deletedAt: null }, orderBy: { name: "asc" }, include: { _count: { select: { campaigns: { where: { deletedAt: null } }, tasks: { where: { deletedAt: null } } } } } }),
    db.brand.findMany({ where: { ...org, deletedAt: { not: null } }, orderBy: { name: "asc" } }),
  ]);
  return { active, archived };
}

export async function createBrand(a: Actor, input: BrandInput) {
  assertCan(a.role, "campaign:manage");
  const d = parse(input);
  const same = await db.brand.findFirst({ where: { organizationId: a.organizationId, name: { equals: d.name, mode: "insensitive" } } });
  if (same && !same.deletedAt) throw new TaskError("يوجد براند بنفس الاسم.");
  if (same) throw new TaskError("يوجد براند مؤرشف بهذا الاسم. استعده من قائمة المؤرشفة.");
  return db.$transaction(async (tx) => {
    const b = await tx.brand.create({ data: { organizationId: a.organizationId, ...d } });
    await logActivity(tx, { organizationId: a.organizationId, actorId: a.id, action: "brand.created", meta: { brandId: b.id, name: b.name } });
    return b;
  });
}

export async function updateBrand(a: Actor, id: string, input: BrandInput) {
  assertCan(a.role, "campaign:manage");
  const d = parse(input);
  const b = await db.brand.findFirst({ where: { id, organizationId: a.organizationId, deletedAt: null } });
  if (!b) throw new TaskError("البراند غير موجود.");
  const clash = await db.brand.findFirst({ where: { organizationId: a.organizationId, id: { not: id }, name: { equals: d.name, mode: "insensitive" } } });
  if (clash) throw new TaskError(clash.deletedAt ? "الاسم مستخدم لبراند مؤرشف." : "يوجد براند بنفس الاسم.");
  await db.$transaction(async (tx) => {
    await tx.brand.update({ where: { id }, data: d });
    await logActivity(tx, { organizationId: a.organizationId, actorId: a.id, action: "brand.updated", meta: { brandId: id, from: b.name, to: d.name } });
  });
}

export async function restoreBrand(a: Actor, id: string) {
  assertCan(a.role, "campaign:manage");
  const r = await db.brand.updateMany({ where: { id, organizationId: a.organizationId, deletedAt: { not: null } }, data: { deletedAt: null } });
  if (r.count !== 1) throw new TaskError("البراند غير موجود.");
  await logActivity(db, { organizationId: a.organizationId, actorId: a.id, action: "brand.restored", meta: { brandId: id } });
}

export async function updateOrganizationName(a: Actor, name: string) {
  assertCan(a.role, "org:settings");
  const n = name.trim();
  if (n.length < 2 || n.length > 100) throw new TaskError("اسم المؤسسة بين 2 و100 حرف.");
  await db.$transaction(async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({ where: { id: a.organizationId }, select: { name: true } });
    await tx.organization.update({ where: { id: a.organizationId }, data: { name: n } });
    await logActivity(tx, { organizationId: a.organizationId, actorId: a.id, action: "org.renamed", meta: { from: before.name, to: n } });
  });
}
