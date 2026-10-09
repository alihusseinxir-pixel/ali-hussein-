import "server-only";
import { z } from "zod";
import { db } from "./db";
import { ForbiddenError, assertCan } from "./rbac";
import { logActivity } from "./activity";
import { BASE_FIELDS, CUSTOM_PREFIX, builtinByKey, customFromRow, resolveTemplate, type CustomFields, type TemplateDef } from "./templates";
import { TaskError, type Actor } from "./tasks";

/** Resolve a template reference for an organization (custom templates are tenant-scoped). */
export async function resolveTemplateRef(organizationId: string, ref: string | null | undefined): Promise<TemplateDef | null> {
  if (!ref) return null;
  if (!ref.startsWith(CUSTOM_PREFIX)) return resolveTemplate(ref);
  const row = await db.contentTemplate.findFirst({ where: { id: ref.slice(CUSTOM_PREFIX.length), organizationId } });
  return row ? customFromRow(row) : null;
}

export async function listCustomTemplates(organizationId: string) {
  const rows = await db.contentTemplate.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
  return rows.flatMap((r) => { const t = customFromRow(r); return t ? [{ row: r, def: t }] : []; });
}

const input = z.object({
  name: z.string().trim().min(2, "الاسم حرفان على الأقل").max(80),
  base: z.string().refine((k) => !!builtinByKey(k), "اختر القالب الأساسي"),
  description: z.string().trim().max(300).optional(),
  defaults: z.record(z.string(), z.string().max(5000)).optional(),
});
export type CustomTemplateInput = z.input<typeof input>;

export async function createCustomTemplate(actor: Actor, raw: CustomTemplateInput) {
  assertCan(actor.role, "template:manage");
  const p = input.safeParse(raw);
  if (!p.success) throw new TaskError(p.error.issues[0].message);
  const { name, base, description, defaults } = p.data;
  const base_ = builtinByKey(base)!;
  if (await db.contentTemplate.findFirst({ where: { organizationId: actor.organizationId, name: { equals: name, mode: "insensitive" } } })) {
    throw new TaskError("يوجد قالب بهذا الاسم.");
  }
  const clean: CustomFields["defaults"] = {};
  for (const k of BASE_FIELDS) { const v = defaults?.[k]?.trim(); if (v && base_.show.includes(k)) clean[k] = v; } // only fields the base template shows
  const fields: CustomFields = { base, description: description || undefined, defaults: clean };
  return db.$transaction(async (tx) => {
    const row = await tx.contentTemplate.create({ data: { organizationId: actor.organizationId, name, contentType: base_.contentType, fields: fields as object } });
    await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, action: "template.created", meta: { name, base } });
    return row;
  });
}

export async function deleteCustomTemplate(actor: Actor, id: string) {
  assertCan(actor.role, "template:manage");
  const row = await db.contentTemplate.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!row) throw new TaskError("القالب غير موجود.");
  // Existing tasks keep their data; they simply fall back to the free-form editor.
  await db.$transaction(async (tx) => {
    await tx.contentTemplate.delete({ where: { id } });
    await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, action: "template.deleted", meta: { name: row.name } });
  });
}

export { ForbiddenError };
