"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ChecklistPhase } from "@prisma/client";
import { requireUser } from "@/lib/session";
import { ForbiddenError } from "@/lib/rbac";
import { TaskError } from "@/lib/tasks";
import { formToObject, type FormState } from "@/lib/form";
import { addChecklistItem, createShoot, deleteShoot, removeChecklistItem, setChecklistDone, setShootStatus, updateShoot, type ShootInput } from "@/lib/shoots";
import { archiveLocation, archiveTalent, createLocation, createTalent, updateLocation, updateTalent } from "@/lib/shoot-resources";

const fail = (e: unknown): FormState => {
  if (e instanceof TaskError || e instanceof ForbiddenError) return { error: e.message };
  throw e;
};
const shootInput = (fd: FormData): ShootInput => ({
  ...formToObject(fd), talentIds: fd.getAll("talentIds").map(String), taskIds: fd.getAll("taskIds").map(String),
} as ShootInput);

export async function createShootAction(_: FormState, fd: FormData): Promise<FormState> {
  const a = await requireUser();
  let id: string;
  try { id = (await createShoot(a, shootInput(fd))).id; } catch (e) { return fail(e); }
  redirect(`/shoots/${id}`);
}
export async function updateShootAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const a = await requireUser();
  try { await updateShoot(a, id, shootInput(fd)); } catch (e) { return fail(e); }
  redirect(`/shoots/${id}`);
}
export async function setShootStatusAction(id: string, status: "COMPLETED" | "CANCELLED") {
  const a = await requireUser();
  await setShootStatus(a, id, status).catch((e) => { if (!(e instanceof TaskError || e instanceof ForbiddenError)) throw e; });
  revalidatePath(`/shoots/${id}`);
}
export async function deleteShootAction(id: string) {
  const a = await requireUser();
  await deleteShoot(a, id).catch((e) => { if (!(e instanceof TaskError || e instanceof ForbiddenError)) throw e; });
  redirect("/shoots");
}

export async function toggleChecklistAction(shootId: string, itemId: string, done: boolean) {
  const a = await requireUser();
  await setChecklistDone(a, itemId, done).catch((e) => { if (!(e instanceof TaskError || e instanceof ForbiddenError)) throw e; });
  revalidatePath(`/shoots/${shootId}`);
}
export async function addChecklistItemAction(shootId: string, phase: ChecklistPhase, _: FormState, fd: FormData): Promise<FormState> {
  const a = await requireUser();
  try { await addChecklistItem(a, shootId, phase, String(fd.get("label") ?? "")); } catch (e) { return fail(e); }
  revalidatePath(`/shoots/${shootId}`);
  return { ok: true };
}
export async function removeChecklistItemAction(shootId: string, itemId: string) {
  const a = await requireUser();
  await removeChecklistItem(a, itemId).catch((e) => { if (!(e instanceof TaskError || e instanceof ForbiddenError)) throw e; });
  revalidatePath(`/shoots/${shootId}`);
}

// models & locations
const done = (): FormState => { revalidatePath("/shoots/resources"); return { ok: true }; };
export async function saveTalentAction(id: string | null, _: FormState, fd: FormData): Promise<FormState> {
  const a = await requireUser();
  try { if (id) await updateTalent(a, id, formToObject(fd)); else await createTalent(a, formToObject(fd)); } catch (e) { return fail(e); }
  return done();
}
export async function archiveTalentAction(id: string) {
  const a = await requireUser();
  await archiveTalent(a, id).catch((e) => { if (!(e instanceof TaskError || e instanceof ForbiddenError)) throw e; });
  revalidatePath("/shoots/resources");
}
export async function saveLocationAction(id: string | null, _: FormState, fd: FormData): Promise<FormState> {
  const a = await requireUser();
  try { if (id) await updateLocation(a, id, formToObject(fd)); else await createLocation(a, formToObject(fd)); } catch (e) { return fail(e); }
  return done();
}
export async function archiveLocationAction(id: string) {
  const a = await requireUser();
  await archiveLocation(a, id).catch((e) => { if (!(e instanceof TaskError || e instanceof ForbiddenError)) throw e; });
  revalidatePath("/shoots/resources");
}
