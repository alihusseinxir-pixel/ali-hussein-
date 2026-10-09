/**
 * Browser-side upload used by the Files panel and by comment attachments.
 * Asks the server how to upload: straight to the bucket via a presigned URL (S3) or through the app (local disk).
 * Throws Error(message) with a user-presentable message.
 */
async function errorOf(res: Response, fallback: string) {
  return (await res.json().catch(() => ({}))).error ?? fallback;
}

export async function uploadTaskFile(taskId: string, file: File, kind: string, commentId?: string | null): Promise<void> {
  const planRes = await fetch(`/api/tasks/${taskId}/files/init`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, size: file.size, kind, commentId: commentId ?? null }),
  });
  if (!planRes.ok) throw new Error(await errorOf(planRes, "Upload failed"));
  const plan = await planRes.json();

  if (plan.mode === "direct") {
    let put: Response;
    try {
      put = await fetch(plan.url, { method: "PUT", headers: { "Content-Type": plan.headers["Content-Type"] }, body: file });
    } catch {
      throw new Error("Could not reach the file storage. Check your connection (or the bucket's CORS settings) and try again.");
    }
    if (!put.ok) throw new Error(put.status === 403 ? "The upload link expired. Please try again." : "The file storage rejected the upload.");
    const done = await fetch(`/api/tasks/${taskId}/files/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: plan.token }) });
    if (!done.ok) throw new Error(await errorOf(done, "Upload failed"));
    return;
  }

  const fd = new FormData();
  fd.set("file", file); fd.set("kind", kind);
  if (commentId) fd.set("commentId", commentId);
  const res = await fetch(`/api/tasks/${taskId}/files`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(await errorOf(res, "Upload failed"));
}
