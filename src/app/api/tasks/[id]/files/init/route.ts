import type { NextRequest } from "next/server";
import { logError } from "@/lib/log-safe";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { planUpload } from "@/lib/files";
import { ForbiddenError } from "@/lib/rbac";
import { TaskError } from "@/lib/tasks";
import { json, sameOrigin } from "@/lib/api-guard";

export const runtime = "nodejs";

const body = z.object({ fileName: z.string().min(1).max(300), size: z.number().int().positive(), kind: z.string().max(30), commentId: z.string().max(60).nullish() });

/** Step 1: ask how to upload. → { mode: "proxy" } or { mode: "direct", url, headers, token }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const user = await getCurrentUser();
  if (!user) return json({ error: "Not signed in" }, 401);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Bad request" }, 400);
  try {
    return json(await planUpload(user, (await params).id, parsed.data));
  } catch (e) {
    if (e instanceof ForbiddenError) return json({ error: e.message }, 403);
    if (e instanceof TaskError) return json({ error: e.message }, 400);
    logError("upload:init", e);
    return json({ error: "Upload failed." }, 500);
  }
}
