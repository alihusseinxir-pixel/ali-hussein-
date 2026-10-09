import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import S3rver from "s3rver";
import type { Actor } from "./tasks";

/** The whole direct-to-bucket upload protocol, against a real S3-compatible server and the real database. */
const tag = `fd${Date.now()}`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0]);

let server: S3rver, dir: string;
let m: {
  db: typeof import("./db").db; tasks: typeof import("./tasks"); files: typeof import("./files"); storage: typeof import("./storage").storage;
  token: typeof import("./upload-token"); schema: typeof import("./task-schema");
};
let orgA: string, orgB: string;
let sm: Actor, video: Actor, video2: Actor, outsider: Actor;
let taskId: string;
const saved = { ...process.env };

async function user(org: string, role: Actor["role"], n: string): Promise<Actor> {
  const u = await m.db.user.create({ data: { organizationId: org, name: n, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: org, role };
}
const put = (plan: Extract<Awaited<ReturnType<typeof m.files.planUpload>>, { mode: "direct" }>, body: Buffer) =>
  fetch(plan.url, { method: "PUT", headers: plan.headers, body: new Uint8Array(body) });
const plan = async (a: Actor, body: Buffer, name = "shot.png", kind = "RAW", commentId?: string) => {
  const p = await m.files.planUpload(a, taskId, { fileName: name, size: body.length, kind, commentId });
  if (p.mode !== "direct") throw new Error("expected direct mode");
  return p;
};

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "basma-fd-"));
  server = new S3rver({ port: 0, address: "127.0.0.1", silent: true, directory: dir, configureBuckets: [{ name: "basma-direct", configs: [] }] });
  const { port } = (await server.run()) as { port: number };
  Object.assign(process.env, { S3_BUCKET: "basma-direct", AWS_REGION: "us-east-1", AWS_ACCESS_KEY_ID: "S3RVER", AWS_SECRET_ACCESS_KEY: "S3RVER", S3_ENDPOINT: `http://127.0.0.1:${port}`, S3_FORCE_PATH_STYLE: "true" });
  delete process.env.STORAGE_DRIVER;
  m = {
    db: (await import("./db")).db, tasks: await import("./tasks"), files: await import("./files"), storage: (await import("./storage")).storage,
    token: await import("./upload-token"), schema: await import("./task-schema"),
  };
  orgA = (await m.db.organization.create({ data: { name: "FD-A", slug: `fda-${tag}` } })).id;
  orgB = (await m.db.organization.create({ data: { name: "FD-B", slug: `fdb-${tag}` } })).id;
  sm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm");
  video = await user(orgA, "VIDEOGRAPHER", "video");
  video2 = await user(orgA, "VIDEOGRAPHER", "video2");
  outsider = await user(orgB, "ADMIN", "out");
  taskId = (await m.tasks.createTask(sm, m.schema.taskInputSchema.parse({ title: "Direct", contentType: "REEL", assigneeId: video.id }))).id;
});
afterAll(async () => {
  for (const org of [orgA, orgB]) {
    await m.db.calendarEvent.deleteMany({ where: { organizationId: org } });
    await m.db.activityLog.deleteMany({ where: { organizationId: org } });
    await m.db.notification.deleteMany({ where: { organizationId: org } });
    await m.db.taskAttachment.deleteMany({ where: { task: { organizationId: org } } });
    await m.db.taskComment.deleteMany({ where: { task: { organizationId: org } } });
    await m.db.task.deleteMany({ where: { organizationId: org } });
    await m.db.taskCounter.deleteMany({ where: { organizationId: org } });
    await m.db.user.deleteMany({ where: { organizationId: org } });
    await m.db.organization.delete({ where: { id: org } });
  }
  await m.db.$disconnect();
  await server?.close();
  rmSync(dir, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

describe("direct upload flow (presigned PUT → verify → record)", () => {
  it("uses the S3 driver because S3_BUCKET is set, and quarantines uploads under pending/", async () => {
    expect(m.storage.direct).toBeDefined();
    const p = await plan(video, PNG);
    expect(p.url).toContain("/pending/");
    expect(p.url).toContain(orgA);
    expect(p.headers["Content-Type"]).toBe("image/png");
  });

  it("completes a good upload: moved out of pending, recorded with a version and an activity entry", async () => {
    const p = await plan(video, PNG);
    expect((await put(p, PNG)).status).toBe(200);
    const row = await m.files.completeUpload(video, p.token);
    expect(row).toMatchObject({ fileName: "shot.png", version: 1, kind: "RAW", sizeBytes: PNG.length, fileType: "image/png", uploadedById: video.id });
    expect(row.fileUrl.startsWith(`${orgA}/${taskId}/`)).toBe(true);
    expect(row.fileUrl).not.toContain("pending");
    expect(await m.storage.size(row.fileUrl)).toBe(PNG.length);
    // second upload of the same name+kind → V2
    const p2 = await plan(video, PNG);
    await put(p2, PNG);
    expect((await m.files.completeUpload(video, p2.token)).version).toBe(2);
    expect(await m.db.activityLog.count({ where: { taskId, action: { in: ["file.uploaded", "file.replaced"] } } })).toBe(2);
  });

  it("rejects a file whose real type is not what its name claims, and deletes it from quarantine", async () => {
    const p = await plan(video, EXE, "evil.png");
    await put(p, EXE);
    const claim = m.token.parseUploadToken(p.token)!;
    await expect(m.files.completeUpload(video, p.token)).rejects.toThrow(/غير مدعوم/);
    await expect(m.storage.size(claim.key)).rejects.toThrow(); // gone
    expect(await m.db.taskAttachment.count({ where: { fileName: "evil.png" } })).toBe(0);
  });

  it("rejects an object whose size differs from the announced size", async () => {
    const p = await plan(video, PNG, "size.png");
    await put({ ...p, headers: { "Content-Type": "image/png" } }, Buffer.concat([PNG, PNG])); // emulator accepts the longer body
    await expect(m.files.completeUpload(video, p.token)).rejects.toThrow(/لا يطابق/);
    expect(await m.db.taskAttachment.count({ where: { fileName: "size.png" } })).toBe(0);
  });

  it("rejects completion when nothing was uploaded, and a replayed token", async () => {
    const none = await plan(video, PNG, "none.png");
    await expect(m.files.completeUpload(video, none.token)).rejects.toThrow(/لم يصل/);
    const p = await plan(video, PNG, "once.png");
    await put(p, PNG);
    await m.files.completeUpload(video, p.token);
    await expect(m.files.completeUpload(video, p.token)).rejects.toThrow(/لم يصل|غير صالح/); // already moved out of pending
    expect(await m.db.taskAttachment.count({ where: { fileName: "once.png" } })).toBe(1);
  });

  it("binds the token to the user and to the signature: others' and forged tokens fail", async () => {
    const p = await plan(video, PNG, "bound.png");
    await put(p, PNG);
    await expect(m.files.completeUpload(sm, p.token)).rejects.toThrow(/غير صالح أو منتهٍ/); // someone else's token
    await expect(m.files.completeUpload(outsider, p.token)).rejects.toThrow(/غير صالح أو منتهٍ/);
    await expect(m.files.completeUpload(video, p.token.slice(0, -3) + "AAA")).rejects.toThrow(/غير صالح أو منتهٍ/);
    const claim = m.token.parseUploadToken(p.token)!;
    const expired = m.token.makeUploadToken(claim, -10);
    await expect(m.files.completeUpload(video, expired)).rejects.toThrow(/غير صالح أو منتهٍ/);
    // a token pointing outside this organization's quarantine area is refused even if correctly signed
    const evil = m.token.makeUploadToken({ ...claim, key: `pending/${orgB}/${taskId}/x.png` }, 60);
    await expect(m.files.completeUpload(video, evil)).rejects.toThrow(/غير صالح أو منتهٍ/);
    await m.files.completeUpload(video, p.token); // the legitimate holder still succeeds
  });

  it("refuses to plan uploads for people who may not upload, bad names, kinds and sizes", async () => {
    const ask = (a: Actor, o: Partial<{ fileName: string; size: number; kind: string }> = {}) => m.files.planUpload(a, taskId, { fileName: "a.png", size: 10, kind: "RAW", ...o });
    await expect(ask(video2)).rejects.toThrow(/غير موجود/); // cannot even see the task
    await expect(ask(outsider)).rejects.toThrow(/غير موجود/);
    await expect(ask(video, { fileName: "run.exe" })).rejects.toThrow(/غير مدعوم/);
    await expect(ask(video, { fileName: "page.html" })).rejects.toThrow(/غير مدعوم/);
    await expect(ask(video, { size: 0 })).rejects.toThrow(/فارغ/);
    await expect(ask(video, { size: 10 * 1024 ** 3 })).rejects.toThrow(/أكبر من/);
    await expect(ask(video, { kind: "NOPE" })).rejects.toThrow(/نوع الملف/);
  });

  it("lets a commenter attach to their own comment through the same flow", async () => {
    const c = await m.db.taskComment.create({ data: { taskId, authorId: sm.id, body: "see file" } });
    const p = await plan(sm, PNG, "note.png", "OTHER", c.id);
    await put(p, PNG);
    expect((await m.files.completeUpload(sm, p.token)).commentId).toBe(c.id);
    await expect(m.files.planUpload(video, taskId, { fileName: "x.png", size: 5, kind: "OTHER", commentId: c.id })).rejects.toThrow(/بتعليقك/);
  });

  it("serves downloads as a short-lived signed redirect target carrying our content type", async () => {
    const f = (await m.db.taskAttachment.findFirstOrThrow({ where: { taskId, fileName: "shot.png", version: 2 } }));
    const url = await m.storage.direct!.presignDownload(f.fileUrl, { contentType: f.fileType, fileName: f.fileName, inline: true, expiresSeconds: 60 });
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });
});
