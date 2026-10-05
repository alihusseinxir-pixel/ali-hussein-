"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formToObject, zodErrors, type FormState } from "@/lib/form";

export async function createBrandAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireUser();
  if (!can(actor.role, "campaign:manage")) return { error: "You do not have permission to do that." };
  const p = z.object({ name: z.string().trim().min(2).max(100) }).safeParse(formToObject(fd));
  if (!p.success) return zodErrors(p.error);
  if (await db.brand.findFirst({ where: { organizationId: actor.organizationId, name: p.data.name } })) return { error: "Brand already exists." };
  await db.brand.create({ data: { organizationId: actor.organizationId, name: p.data.name } });
  revalidatePath("/campaigns");
  return { ok: true };
}

export async function createCampaignAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireUser();
  if (!can(actor.role, "campaign:manage")) return { error: "You do not have permission to do that." };
  const p = z.object({ name: z.string().trim().min(2).max(100), brandId: z.string().min(1, "Choose a brand") }).safeParse(formToObject(fd));
  if (!p.success) return zodErrors(p.error);
  const brand = await db.brand.findFirst({ where: { id: p.data.brandId, organizationId: actor.organizationId, deletedAt: null } });
  if (!brand) return { error: "Unknown brand." };
  if (await db.campaign.findFirst({ where: { organizationId: actor.organizationId, brandId: brand.id, name: p.data.name } })) return { error: "Campaign already exists for this brand." };
  await db.campaign.create({ data: { organizationId: actor.organizationId, brandId: brand.id, name: p.data.name, createdById: actor.id } });
  revalidatePath("/campaigns");
  return { ok: true };
}
