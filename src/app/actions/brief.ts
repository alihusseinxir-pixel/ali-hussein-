"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { ForbiddenError } from "@/lib/rbac";
import { TaskError } from "@/lib/tasks";
import { createShareLink, revokeShareLinks } from "@/lib/brief-share";

export type ShareResult = { url?: string; expiresAt?: string; error?: string; ok?: boolean };

export async function createBriefShareAction(taskId: string, days: number): Promise<ShareResult> {
  const actor = await requireUser();
  try {
    const r = await createShareLink(actor, taskId, days);
    revalidatePath(`/tasks/${taskId}`);
    return { url: r.url, expiresAt: r.expiresAt.toISOString() };
  } catch (e) {
    if (e instanceof TaskError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
}

export async function revokeBriefSharesAction(taskId: string): Promise<ShareResult> {
  const actor = await requireUser();
  try {
    await revokeShareLinks(actor, taskId);
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof TaskError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
}
