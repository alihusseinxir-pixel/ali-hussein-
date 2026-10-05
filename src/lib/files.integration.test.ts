import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { createTask, type Actor } from "./tasks";
import { deleteFile, getFileForUser, listFiles, planUpload, uploadFile } from "./files";
import { storage } from "./storage";
import { taskInputSchema } from "./task-schema";
import { ForbiddenError } from "./rbac";
import { acceptHandover } from "./handover";

const tag = `f${Date.now()}`;
let orgA: string, orgB: string;
let sm: Actor, video: Actor, video2: Actor, outsider: Actor;
let taskId: string;
const file = (bytes: number[], name: string) => new File([new Uint8Array(bytes)], name);
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];

async function user(org: string, role: Actor["role"], n: string): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: org, name: n, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: org, role };
}

beforeAll(async () => {
  orgA = (await db.organization.create({ data: { name: "FA", slug: `fa-${tag}` } })).id;
  orgB = (await db.organization.create({ data: { name: "FB", slug: `fb-${tag}` } })).id;
  sm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm");
  video = await user(orgA, "VIDEOGRAPHER", "video");
  video2 = await user(orgA, "VIDEOGRAPHER", "video2");
  outsider = await user(orgB, "ADMIN", "out");
  const t = await createTask(sm, taskInputSchema.parse({ title: "Files", contentType: "REEL", assigneeId: video.id }));
  taskId = t.id;
  await acceptHandover(video, (await db.taskHandoff.findFirstOrThrow({ where: { taskId } })).id);
});
afterAll(async () => {
  for (const org of [orgA, orgB]) {
    await db.activityLog.deleteMany({ where: { organizationId: org } });
    await db.notification.deleteMany({ where: { organizationId: org } });
    await db.task.deleteMany({ where: { organizationId: org } });
    await db.taskCounter.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { organizationId: org } });
    await db.organization.delete({ where: { id: org } });
  }
  await db.$disconnect();
});

describe("files (integration)", () => {
  it("accepts real files and rejects spoofed / unsupported ones", async () => {
    await expect(uploadFile(video, taskId, file([0x4d, 0x5a, 0x90, 0], "evil.png"), "RAW")).rejects.toThrow(/Unsupported/); // exe bytes named .png
    await expect(uploadFile(video, taskId, file(PNG, "run.exe"), "RAW")).rejects.toThrow(/Unsupported/);
    await expect(uploadFile(video, taskId, file(PNG, "x.svg"), "RAW")).rejects.toThrow(/Unsupported/);
    await expect(uploadFile(video, taskId, file([], "empty.png"), "RAW")).rejects.toThrow(/empty/);
    await expect(uploadFile(video, taskId, file(PNG, "ok.png"), "BOGUS")).rejects.toThrow(/kind/);
    const ok = await uploadFile(video, taskId, file(PDF, "script.pdf"), "DOCUMENT");
    expect(ok.fileType).toBe("application/pdf");
    expect(await storage.size(ok.fileUrl)).toBe(PDF.length);
  });

  it("local storage has no direct access, so uploads use the proxy path", async () => {
    expect(storage.direct).toBeUndefined();
    expect(await planUpload(video, taskId, { fileName: "a.png", size: 10, kind: "RAW" })).toEqual({ mode: "proxy" });
    await expect(planUpload(video, taskId, { fileName: "a.exe", size: 10, kind: "RAW" })).rejects.toThrow(/Unsupported/); // validated before choosing a path
  });

  it("sanitises names (no path traversal, keeps Arabic)", async () => {
    const f = await uploadFile(video, taskId, file(PNG, "../../etc/طازج.png"), "RAW");
    expect(f.fileName).toBe("طازج.png");
    expect(f.fileUrl.startsWith(`${orgA}/${taskId}/`)).toBe(true);
  });

  it("versions repeated uploads of the same name+kind and keeps history", async () => {
    const v1 = await uploadFile(video, taskId, file(PNG, "Final.png"), "FINAL");
    const v2 = await uploadFile(video, taskId, file(PNG, "Final.png"), "FINAL");
    const [a, b] = await Promise.all([uploadFile(video, taskId, file(PNG, "Final.png"), "FINAL"), uploadFile(video, taskId, file(PNG, "Final.png"), "FINAL")]);
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(new Set([a.version, b.version]).size).toBe(2); // concurrent uploads never collide
    const all = await listFiles(sm, taskId);
    expect(all.filter((f) => f.fileName === "Final.png")).toHaveLength(4);
  });

  it("only owners/creators can upload; strangers and other orgs cannot see files", async () => {
    await expect(uploadFile(video2, taskId, file(PNG, "x.png"), "RAW")).rejects.toThrow(); // not visible at all
    await expect(uploadFile(outsider, taskId, file(PNG, "x.png"), "RAW")).rejects.toThrow();
    const f = (await listFiles(sm, taskId))[0];
    expect(await getFileForUser(video, f.id)).not.toBeNull();
    expect(await getFileForUser(video2, f.id)).toBeNull();
    expect(await getFileForUser(outsider, f.id)).toBeNull();
    expect(await listFiles(outsider, taskId)).toHaveLength(0);
  });

  it("soft-deletes: hidden from lists, row and blob kept; strangers cannot delete", async () => {
    const f = await uploadFile(video, taskId, file(PNG, "del.png"), "OTHER");
    await expect(deleteFile(outsider, f.id)).rejects.toThrow();
    await expect(deleteFile(sm, f.id)).rejects.toThrow(ForbiddenError); // social media created the task but is neither uploader nor editor-any
    await deleteFile(video, f.id);
    expect(await getFileForUser(video, f.id)).toBeNull();
    expect((await db.taskAttachment.findUnique({ where: { id: f.id } }))?.deletedAt).not.toBeNull();
    expect(await storage.size(f.fileUrl)).toBeGreaterThan(0);
  });
});
