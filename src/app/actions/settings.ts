"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { ForbiddenError } from "@/lib/rbac";
import { TaskError } from "@/lib/tasks";
import { formToObject, type FormState } from "@/lib/form";
import { archiveBrand } from "@/lib/campaigns";
import { createBrand, restoreBrand, updateBrand, updateOrganizationName } from "@/lib/settings";

const fail = (e: unknown): FormState => {
  if (e instanceof TaskError || e instanceof ForbiddenError) return { error: e.message };
  throw e;
};
const done = (): FormState => { revalidatePath("/settings"); revalidatePath("/campaigns"); return { ok: true }; };
const brandFields = (fd: FormData) => { const r = formToObject(fd); return { name: r.name ?? "", guidelinesUrl: r.guidelinesUrl }; };

export async function saveBrandAction(id: string | null, _: FormState, fd: FormData): Promise<FormState> {
  const a = await requireUser();
  try { if (id) await updateBrand(a, id, brandFields(fd)); else await createBrand(a, brandFields(fd)); } catch (e) { return fail(e); }
  return done();
}
export async function archiveBrandFromSettingsAction(id: string, _: FormState, __: FormData): Promise<FormState> {
  const a = await requireUser();
  try { await archiveBrand(a, id); } catch (e) { return fail(e); }
  return done();
}
export async function restoreBrandAction(id: string, _: FormState, __: FormData): Promise<FormState> {
  const a = await requireUser();
  try { await restoreBrand(a, id); } catch (e) { return fail(e); }
  return done();
}
export async function renameOrganizationAction(_: FormState, fd: FormData): Promise<FormState> {
  const a = await requireUser();
  try { await updateOrganizationName(a, String(fd.get("name") ?? "")); } catch (e) { return fail(e); }
  revalidatePath("/", "layout");
  return { ok: true };
}
