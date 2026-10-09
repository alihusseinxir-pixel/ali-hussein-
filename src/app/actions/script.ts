"use server";
import { revalidatePath } from "next/cache";
import type { ScriptStatus } from "@prisma/client";
import { requireUser } from "@/lib/session";
import { ForbiddenError } from "@/lib/rbac";
import { TaskError } from "@/lib/tasks";
import { changeScriptStatus, createTaskFromScene, saveScenes, type SceneInput } from "@/lib/script";

export type ScriptResult = { ok?: boolean; error?: string; version?: number; status?: ScriptStatus };

const fail = (e: unknown): ScriptResult => {
  if (e instanceof TaskError || e instanceof ForbiddenError) return { error: e.message };
  throw e;
};

export async function saveScriptAction(taskId: string, expectedVersion: number, scenes: SceneInput[]): Promise<ScriptResult> {
  const actor = await requireUser();
  try {
    const r = await saveScenes(actor, taskId, scenes, expectedVersion);
    revalidatePath(`/tasks/${taskId}/script`);
    return { ok: true, version: r.version };
  } catch (e) { return fail(e); }
}

export async function changeScriptStatusAction(taskId: string, to: ScriptStatus, note: string, expectedVersion: number): Promise<ScriptResult> {
  const actor = await requireUser();
  try {
    const r = await changeScriptStatus(actor, taskId, to, note, expectedVersion);
    revalidatePath(`/tasks/${taskId}/script`);
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true, version: r.version, status: r.status };
  } catch (e) { return fail(e); }
}

export async function createSceneTaskAction(taskId: string, sceneNumber: number): Promise<ScriptResult> {
  const actor = await requireUser();
  try {
    await createTaskFromScene(actor, taskId, sceneNumber);
    revalidatePath(`/tasks/${taskId}/script`);
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}
