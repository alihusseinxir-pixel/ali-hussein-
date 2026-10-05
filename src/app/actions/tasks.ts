"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { ForbiddenError } from "@/lib/rbac";
import { formToObject, zodErrors, type FormState } from "@/lib/form";
import { taskInputSchema } from "@/lib/task-schema";
import { handoverSchema, revisionSchema } from "@/lib/handover-schema";
import { addComment, deleteComment } from "@/lib/comments";
import { acceptHandover, requestChanges, submitHandover } from "@/lib/handover";
import { TaskError, assignTask, createTask, deleteTask, updateTask } from "@/lib/tasks";

function toState(e: unknown): FormState {
  if (e instanceof TaskError || e instanceof ForbiddenError) return { error: e.message };
  throw e;
}

/** Form fields named `extra.<key>` carry template-specific values. */
function taskFormData(fd: FormData) {
  const raw = formToObject(fd);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (k.startsWith("extra.")) extra[k.slice(6)] = v;
  return { ...raw, extra };
}

export async function createTaskAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = taskInputSchema.safeParse(taskFormData(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  let id: string;
  try { id = (await createTask(actor, parsed.data)).id; } catch (e) { return toState(e); }
  redirect(`/tasks/${id}`);
}

export async function updateTaskAction(taskId: string, _: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = taskInputSchema.safeParse(taskFormData(fd));
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

export async function submitHandoverAction(taskId: string, _: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = handoverSchema.safeParse(formToObject(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  try { await submitHandover(actor, taskId, parsed.data); } catch (e) { return toState(e); }
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

export async function requestChangesAction(taskId: string, _: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireUser();
  const parsed = revisionSchema.safeParse(formToObject(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  try { await requestChanges(actor, taskId, parsed.data.notes); } catch (e) { return toState(e); }
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

export async function acceptHandoverAction(taskId: string, fd: FormData) {
  const actor = await requireUser();
  try { await acceptHandover(actor, String(fd.get("handoffId"))); } catch (e) { if (!(e instanceof TaskError)) throw e; }
  revalidatePath(`/tasks/${taskId}`);
}

export async function addCommentAction(taskId: string, _: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireUser();
  try {
    const c = await addComment(actor, taskId, String(fd.get("body") ?? ""));
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true, data: c.id };
  } catch (e) { return toState(e); }
}

export async function deleteCommentAction(taskId: string, fd: FormData) {
  const actor = await requireUser();
  try { await deleteComment(actor, String(fd.get("commentId"))); } catch (e) { if (!(e instanceof TaskError || e instanceof ForbiddenError)) throw e; }
  revalidatePath(`/tasks/${taskId}`);
}
