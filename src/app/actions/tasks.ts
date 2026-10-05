"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { ForbiddenError } from "@/lib/rbac";
import { formToObject, zodErrors, type FormState } from "@/lib/form";
import { taskInputSchema } from "@/lib/task-schema";
import { TaskError, assignTask, createTask, deleteTask, updateTask } from "@/lib/tasks";

function toState(e: unknown): FormState {
  if (e instanceof TaskError || e instanceof ForbiddenError) return { error: e.message };
  throw e;
}

export async function createTaskAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = taskInputSchema.safeParse(formToObject(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  let id: string;
  try { id = (await createTask(actor, parsed.data)).id; } catch (e) { return toState(e); }
  redirect(`/tasks/${id}`);
}

export async function updateTaskAction(taskId: string, _: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = taskInputSchema.safeParse(formToObject(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  try { await updateTask(actor, taskId, parsed.data); } catch (e) { return toState(e); }
  redirect(`/tasks/${taskId}`);
}

export async function assignTaskAction(taskId: string, _: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireUser();
  const assigneeId = String(fd.get("assigneeId") ?? "");
  if (!assigneeId) return { error: "Choose a person." };
  try { await assignTask(actor, taskId, assigneeId); } catch (e) { return toState(e); }
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

export async function deleteTaskAction(taskId: string) {
  const actor = await requireUser();
  await deleteTask(actor, taskId);
  redirect("/tasks");
}
