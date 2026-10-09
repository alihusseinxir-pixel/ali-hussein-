"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { ForbiddenError } from "@/lib/rbac";
import { TaskError } from "@/lib/tasks";
import { createCustomTemplate, deleteCustomTemplate } from "@/lib/templates-db";
import { formToObject, type FormState } from "@/lib/form";

export async function createTemplateAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireUser();
  const raw = formToObject(fd);
  const defaults: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (k.startsWith("default.")) defaults[k.slice(8)] = v;
  try {
    await createCustomTemplate(actor, { name: raw.name ?? "", base: raw.base ?? "", description: raw.description, defaults });
  } catch (e) {
    if (e instanceof TaskError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  revalidatePath("/templates");
  return { ok: true };
}

export async function deleteTemplateAction(fd: FormData) {
  const actor = await requireUser();
  try { await deleteCustomTemplate(actor, String(fd.get("id"))); } catch (e) { if (!(e instanceof TaskError || e instanceof ForbiddenError)) throw e; }
  revalidatePath("/templates");
}
