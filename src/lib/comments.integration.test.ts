import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { createTask, type Actor } from "./tasks";
import { addComment, deleteComment, listComments, taskParticipants } from "./comments";
import { uploadFile, listFiles, filesSinceLastHandover } from "./files";
import { taskInputSchema } from "./task-schema";
import { ForbiddenError } from "./rbac";

const tag = `c${Date.now()}`;
let orgA: string, orgB: string;
let sm: Actor, mm: Actor, video: Actor, video2: Actor, outsider: Actor;
let taskId: string;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);

async function user(org: string, role: Actor["role"], n: string, name: string): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: org, name, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: org, role };
}

beforeAll(async () => {
  orgA = (await db.organization.create({ data: { name: "CA", slug: `ca-${tag}` } })).id;
  orgB = (await db.organization.create({ data: { name: "CB", slug: `cb-${tag}` } })).id;
  sm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm", "Sama");
  mm = await user(orgA, "MARKETING_MANAGER", "mm", "Mona");
  video = await user(orgA, "VIDEOGRAPHER", "video", "Ahmed");
  video2 = await user(orgA, "VIDEOGRAPHER", "video2", "Omar");
  outsider = await user(orgB, "ADMIN", "out", "Zed");
  taskId = (await createTask(sm, taskInputSchema.parse({ title: "Comments", contentType: "REEL", assigneeId: video.id }))).id;
});
afterAll(async () => {
  for (const org of [orgA, orgB]) {
    await db.activityLog.deleteMany({ where: { organizationId: org } });
    await db.notification.deleteMany({ where: { organizationId: org } });
    await db.taskAttachment.deleteMany({ where: { task: { organizationId: org } } });
    await db.taskComment.deleteMany({ where: { task: { organizationId: org } } });
    await db.task.deleteMany({ where: { organizationId: org } });
    await db.taskCounter.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { organizationId: org } });
    await db.organization.delete({ where: { id: org } });
  }
  await db.$disconnect();
});

describe("comments (integration)", () => {
  it("stores mentions and notifies mentioned people, assignee and creator once each", async () => {
    const c = await addComment(video, taskId, "Need a reshoot of scene 2 @Mona and @Sama");
    expect(c.mentions.sort()).toEqual([mm.id, sm.id].sort());
    expect(await db.notification.count({ where: { taskId, userId: mm.id, type: "MENTION" } })).toBe(1);
    expect(await db.notification.count({ where: { taskId, userId: sm.id, type: "MENTION" } })).toBe(1);
    expect(await db.notification.count({ where: { taskId, userId: sm.id, type: "COMMENT" } })).toBe(0); // no duplicate for the same person
    const c2 = await addComment(sm, taskId, "Ok, shoot at 5");
    expect(c2.mentions).toEqual([]);
    expect(await db.notification.count({ where: { taskId, userId: video.id, type: "COMMENT" } })).toBe(1);
    expect(await db.notification.count({ where: { taskId, userId: sm.id, type: "COMMENT" } })).toBe(0); // never notify yourself
    expect((await listComments(sm, taskId)).map((x) => x.body)).toHaveLength(2);
  });

  it("only participants can be mentioned; other orgs and unrelated production users are invisible", async () => {
    const ctx = await taskParticipants(sm, taskId);
    const names = ctx!.people.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Sama", "Mona", "Ahmed"]));
    expect(names).not.toContain("Omar"); // unrelated videographer cannot see this task
    expect(names).not.toContain("Zed");
    const c = await addComment(sm, taskId, "cc @Omar @Zed");
    expect(c.mentions).toEqual([]);
  });

  it("people who cannot see the task cannot read or write comments", async () => {
    await expect(addComment(video2, taskId, "hi")).rejects.toThrow(/غير موجود/);
    await expect(addComment(outsider, taskId, "hi")).rejects.toThrow(/غير موجود/);
    expect(await listComments(video2, taskId)).toHaveLength(0);
    await expect(addComment(video, taskId, "   ")).rejects.toThrow(/اكتب تعليقاً/);
  });

  it("only the author or an admin can delete; deletion is soft", async () => {
    const c = await addComment(video, taskId, "to delete");
    await expect(deleteComment(sm, c.id)).rejects.toThrow(ForbiddenError);
    await expect(deleteComment(outsider, c.id)).rejects.toThrow(/غير موجود/);
    await deleteComment(video, c.id);
    expect((await listComments(sm, taskId)).find((x) => x.id === c.id)).toBeUndefined();
    expect(await db.taskComment.findUnique({ where: { id: c.id } })).not.toBeNull();
  });

  it("a commenter can attach to their own comment but those files never satisfy handover gates", async () => {
    const c = await addComment(mm, taskId, "see attached");
    const f = await uploadFile(mm, taskId, new File([PNG], "note.png"), "RAW", c.id);
    expect(f.commentId).toBe(c.id);
    const other = await addComment(sm, taskId, "mine");
    await expect(uploadFile(mm, taskId, new File([PNG], "y.png"), "OTHER", other.id)).rejects.toThrow(ForbiddenError); // someone else's comment
    expect((await listComments(sm, taskId)).find((x) => x.id === c.id)?.attachments).toHaveLength(1);
    expect((await listFiles(sm, taskId)).some((x) => x.id === f.id)).toBe(true);
    expect((await db.$transaction((tx) => filesSinceLastHandover(tx, taskId))).some((x) => x.id === f.id)).toBe(false);
  });
});
