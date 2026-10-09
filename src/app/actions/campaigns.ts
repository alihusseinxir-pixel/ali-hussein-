"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ForbiddenError, can } from "@/lib/rbac";
import { TaskError } from "@/lib/tasks";
import { archiveBrand, archiveCampaign, updateCampaign } from "@/lib/campaigns";
import { createBrand } from "@/lib/settings";
import { formToObject, zodErrors, type FormState } from "@/lib/form";

export async function createBrandAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireUser();
  try { await createBrand(actor, { name: formToObject(fd).name ?? "" }); } catch (e) {
    if (e instanceof TaskError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  revalidatePath("/campaigns"); revalidatePath("/settings");
  return { ok: true };
}

export async function createCampaignAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireUser();
  if (!can(actor.role, "campaign:manage")) return { error: "ليست لديك صلاحية لهذا الإجراء." };
  const p = z.object({ name: z.string().trim().min(2).max(100), brandId: z.string().min(1, "اختر براند") }).safeParse(formToObject(fd));
  if (!p.success) return zodErrors(p.error);
  const brand = await db.brand.findFirst({ where: { id: p.data.brandId, organizationId: actor.organizationId, deletedAt: null } });
  if (!brand) return { error: "البراند غير موجود." };
  if (await db.campaign.findFirst({ where: { organizationId: actor.organizationId, brandId: brand.id, name: p.data.name } })) return { error: "توجد حملة بهذا الاسم لهذا البراند." };
  await db.campaign.create({ data: { organizationId: actor.organizationId, brandId: brand.id, name: p.data.name, createdById: actor.id } });
  revalidatePath("/campaigns");
  return { ok: true };
}

export async function updateCampaignAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireUser();
  const raw = formToObject(fd);
  try {
    await updateCampaign(actor, id, { name: raw.name ?? "", description: raw.description, startDate: raw.startDate, endDate: raw.endDate });
  } catch (e) {
    if (e instanceof TaskError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/campaigns/${id}`); revalidatePath("/campaigns");
  return { ok: true };
}

export async function archiveCampaignAction(id: string, _: FormState, __: FormData): Promise<FormState> {
  const actor = await requireUser();
  try { await archiveCampaign(actor, id); } catch (e) {
    if (e instanceof TaskError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  redirect("/campaigns");
}

export async function archiveBrandAction(fd: FormData) {
  const actor = await requireUser();
  try { await archiveBrand(actor, String(fd.get("id"))); } catch (e) { if (!(e instanceof TaskError || e instanceof ForbiddenError)) throw e; }
  revalidatePath("/campaigns");
}
