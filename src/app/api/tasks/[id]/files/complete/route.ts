import type { NextRequest } from "next/server";
import { logError } from "@/lib/log-safe";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { completeUpload } from "@/lib/files";
import { ForbiddenError } from "@/lib/rbac";
import { TaskError } from "@/lib/tasks";
import { json, sameOrigin } from "@/lib/api-guard";

export const runtime = "nodejs";

/** Step 3 of a direct upload: the browser finished the PUT; the server verifies the object and records it. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const user = await getCurrentUser();
  if (!user) return json({ error: "Not signed in" }, 401);
  const parsed = z.object({ token: z.string().min(20).max(2000) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Bad request" }, 400);
  void params; // the task is bound inside the signed token
  try {
    const row = await completeUpload(user, parsed.data.token);
    return json({ id: row.id, fileName: row.fileName, version: row.version }, 201);
  } catch (e) {
    if (e instanceof ForbiddenError) return json({ error: e.message }, 403);
    if (e instanceof TaskError) return json({ error: e.message }, 400);
    logError("upload:complete", e);
    return json({ error: "Upload failed." }, 500);
  }
}
