import "server-only";
import { z } from "zod";
import { db } from "./db";
import { assertCan } from "./rbac";
import { TaskError, type Actor } from "./tasks";

const opt = (max: number) => z.string().trim().max(max, `الحد الأقصى ${max} حرف`).optional().transform((v) => (v ? v : null));
const name = z.string().trim().min(2, "الاسم مطلوب (حرفان على الأقل)").max(120);
export const talentSchema = z.object({
  name, phone: opt(40), notes: opt(1000),
  email: opt(200).refine((v) => !v || z.email().safeParse(v).success, "البريد الإلكتروني غير صالح"),
});
export const locationSchema = z.object({
  name, address: opt(500), notes: opt(1000),
  // only http(s) links are stored, so the map link can never be a javascript: URL
  mapUrl: opt(1000).refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "رابط الخريطة يجب أن يبدأ بـ http:// أو https://"),
});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new TaskError(r.error.issues[0].message);
  return r.data;
}

export const listTalents = (a: Actor) => db.talent.findMany({ where: { organizationId: a.organizationId, deletedAt: null }, orderBy: { name: "asc" } });
export const listLocations = (a: Actor) => db.location.findMany({ where: { organizationId: a.organizationId, deletedAt: null }, orderBy: { name: "asc" } });

export async function createTalent(a: Actor, input: unknown) {
  assertCan(a.role, "shoot:manage");
  return db.talent.create({ data: { ...parse(talentSchema, input), organizationId: a.organizationId } });
}
export async function updateTalent(a: Actor, id: string, input: unknown) {
  assertCan(a.role, "shoot:manage");
  const r = await db.talent.updateMany({ where: { id, organizationId: a.organizationId, deletedAt: null }, data: parse(talentSchema, input) });
  if (r.count !== 1) throw new TaskError("المودل غير موجود.");
}
export async function archiveTalent(a: Actor, id: string) {
  assertCan(a.role, "shoot:manage");
  const r = await db.talent.updateMany({ where: { id, organizationId: a.organizationId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (r.count !== 1) throw new TaskError("المودل غير موجود.");
}
export async function createLocation(a: Actor, input: unknown) {
  assertCan(a.role, "shoot:manage");
  return db.location.create({ data: { ...parse(locationSchema, input), organizationId: a.organizationId } });
}
export async function updateLocation(a: Actor, id: string, input: unknown) {
  assertCan(a.role, "shoot:manage");
  const r = await db.location.updateMany({ where: { id, organizationId: a.organizationId, deletedAt: null }, data: parse(locationSchema, input) });
  if (r.count !== 1) throw new TaskError("اللوكيشن غير موجود.");
}
export async function archiveLocation(a: Actor, id: string) {
  assertCan(a.role, "shoot:manage");
  const r = await db.location.updateMany({ where: { id, organizationId: a.organizationId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (r.count !== 1) throw new TaskError("اللوكيشن غير موجود.");
}
