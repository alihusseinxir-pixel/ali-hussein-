import type { NextRequest } from "next/server";
import { logError } from "@/lib/log-safe";
import { getCurrentUser } from "@/lib/session";
import { MAX_UPLOAD_BYTES, uploadFile } from "@/lib/files";
import { ForbiddenError } from "@/lib/rbac";
import { TaskError } from "@/lib/tasks";
import { json, sameOrigin } from "@/lib/api-guard";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const user = await getCurrentUser();
  if (!user) return json({ error: "Not signed in" }, 401);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 1024 * 1024) return json({ error: "File too large." }, 413);
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return json({ error: "No file provided." }, 400);
  try {
    const row = await uploadFile(user, id, file, String(form?.get("kind") ?? "OTHER"), (form?.get("commentId") as string | null) || null);
    return json({ id: row.id, fileName: row.fileName, version: row.version }, 201);
  } catch (e) {
    if (e instanceof ForbiddenError) return json({ error: e.message }, 403);
    if (e instanceof TaskError) return json({ error: e.message }, 400);
    logError("upload", e);
    return json({ error: "Upload failed." }, 500);
  }
}
