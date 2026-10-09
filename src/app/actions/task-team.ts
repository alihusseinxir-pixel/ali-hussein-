"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { ForbiddenError } from "@/lib/rbac";
import { TaskError } from "@/lib/tasks";
import type { FormState } from "@/lib/form";
import { addCollaborator, addTaskChecklistItem, removeCollaborator, removeTaskChecklistItem, setTaskChecklistDone } from "@/lib/task-team";

const fail = (e: unknown): FormState => {
  if (e instanceof TaskError || e instanceof ForbiddenError) return { error: e.message };
  throw e;
};
const quiet = (e: unknown) => { if (!(e instanceof TaskError || e instanceof ForbiddenError)) throw e; };

export async function addCollaboratorAction(taskId: string, _: FormState, fd: FormData): Promise<FormState> {
  const a = await requireUser();
  try { await addCollaborator(a, taskId, String(fd.get("userId") ?? "")); } catch (e) { return fail(e); }
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}
export async function removeCollaboratorAction(taskId: string, userId: string) {
  const a = await requireUser();
  await removeCollaborator(a, taskId, userId).catch(quiet);
  revalidatePath(`/tasks/${taskId}`);
}
export async function addTaskChecklistItemAction(taskId: string, _: FormState, fd: FormData): Promise<FormState> {
  const a = await requireUser();
  try { await addTaskChecklistItem(a, taskId, String(fd.get("label") ?? "")); } catch (e) { return fail(e); }
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}
export async function toggleTaskChecklistAction(taskId: string, itemId: string, done: boolean) {
  const a = await requireUser();
  await setTaskChecklistDone(a, itemId, done).catch(quiet);
  revalidatePath(`/tasks/${taskId}`);
}
export async function removeTaskChecklistItemAction(taskId: string, itemId: string) {
  const a = await requireUser();
  await removeTaskChecklistItem(a, itemId).catch(quiet);
  revalidatePath(`/tasks/${taskId}`);
}
