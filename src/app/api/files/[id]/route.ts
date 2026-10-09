import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { deleteFile, getFileForUser } from "@/lib/files";
import { FILE_TYPES, extensionOf } from "@/lib/file-types";
import { PRESIGN_TTL_SECONDS, storage } from "@/lib/storage";
import { ForbiddenError } from "@/lib/rbac";
import { TaskError } from "@/lib/tasks";
import { json, sameOrigin } from "@/lib/api-guard";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Not signed in" }, 401);
  const file = await getFileForUser(user, (await params).id);
  if (!file) return json({ error: "Not found" }, 404);

  const type = FILE_TYPES[extensionOf(file.fileName)];
  const download = req.nextUrl.searchParams.get("download") === "1" || !type?.inline;
  const size = await storage.size(file.fileUrl).catch(() => null);
  if (size === null) return json({ error: "File is missing from storage." }, 410);

  // Direct storage (S3): permissions were checked above; hand the browser a short-lived signed URL so the bytes
  // (incl. video range requests) flow straight from the bucket. Type and disposition come from OUR whitelist, not from the object.
  if (storage.direct && type) {
    const url = await storage.direct.presignDownload(file.fileUrl, { contentType: type.mime, fileName: file.fileName, inline: !download, expiresSeconds: PRESIGN_TTL_SECONDS });
    return new NextResponse(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  }

  const headers = new Headers({
    "Content-Type": type?.mime ?? "application/octet-stream",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Accept-Ranges": "bytes",
  });

  // Inline renderable types are locked down; the PDF viewer needs plugin access so it is left out of the sandbox.
  if (!download && type?.mime !== "application/pdf") headers.set("Content-Security-Policy", "sandbox; default-src 'none'; media-src 'self'; img-src 'self'");

  // Single byte-range support so video seeking works.
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    start = Math.max(0, start);
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    const stream = Readable.toWeb(await storage.get(file.fileUrl, { start, end })) as ReadableStream;
    return new NextResponse(stream, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new NextResponse(Readable.toWeb(await storage.get(file.fileUrl)) as ReadableStream, { headers });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const user = await getCurrentUser();
  if (!user) return json({ error: "Not signed in" }, 401);
  try {
    await deleteFile(user, (await params).id);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof ForbiddenError) return json({ error: e.message }, 403);
    if (e instanceof TaskError) return json({ error: e.message }, 404);
    throw e;
  }
}
