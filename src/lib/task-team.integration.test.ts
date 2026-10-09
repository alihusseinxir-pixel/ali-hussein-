import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { PAGE_SIZE, createTask, getTask, listTasks, type Actor } from "./tasks";
import { taskInputSchema } from "./task-schema";
import { addCollaborator, addTaskChecklistItem, listCollaborators, listTaskChecklist, removeCollaborator, removeTaskChecklistItem, setTaskChecklistDone } from "./task-team";

const tag = `tt${Date.now()}`;
let orgA: string, orgB: string;
let sm: Actor, mm: Actor, video: Actor, editor: Actor, designer: Actor, outsider: Actor;
let t1: string;
const mk = (a: Actor, over: Record<string, unknown> = {}) => createTask(a, taskInputSchema.parse({ title: "Reel A", contentType: "REEL", ...over }));

async function user(org: string, role: Actor["role"], n: string): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: org, name: n, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: org, role };
}
beforeAll(async () => {
  orgA = (await db.organization.create({ data: { name: "TA", slug: `ta-${tag}` } })).id;
  orgB = (await db.organization.create({ data: { name: "TB", slug: `tb-${tag}` } })).id;
  sm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm");
  mm = await user(orgA, "MARKETING_MANAGER", "mm");
  video = await user(orgA, "VIDEOGRAPHER", "video");
  editor = await user(orgA, "VIDEO_EDITOR", "editor");
  designer = await user(orgA, "DESIGNER", "designer");
  outsider = await user(orgB, "ADMIN", "out");
  t1 = (await mk(sm, { assigneeId: video.id })).id;
});
afterAll(async () => {
  for (const org of [orgA, orgB]) {
    await db.activityLog.deleteMany({ where: { organizationId: org } });
    await db.notification.deleteMany({ where: { organizationId: org } });
    await db.task.deleteMany({ where: { organizationId: org } });
    await db.campaign.deleteMany({ where: { organizationId: org } });
    await db.brand.deleteMany({ where: { organizationId: org } });
    await db.taskCounter.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { organizationId: org } });
    await db.organization.delete({ where: { id: org } });
  }
  await db.$disconnect();
});

describe("duplicate prevention", () => {
  it("rejects an open task with the same title in the same campaign, unless explicitly allowed", async () => {
    await expect(mk(sm, { title: "  reel a " })).rejects.toThrow(/بنفس الاسم/);
    const ok = await mk(sm, { title: "Reel A", allowDuplicate: "1" });
    expect(ok.id).toBeTruthy();
  });
  it("different titles or different campaigns are fine", async () => {
    await mk(sm, { title: "Reel B" });
    const brand = await db.brand.create({ data: { organizationId: orgA, name: "BR" } });
    const camp = await db.campaign.create({ data: { organizationId: orgA, brandId: brand.id, name: "C1" } });
    await mk(sm, { title: "Reel A", campaignId: camp.id });
    await expect(mk(sm, { title: "Reel A", campaignId: camp.id })).rejects.toThrow(/بنفس الاسم/);
  });
  it("closed tasks do not block reuse of a title", async () => {
    const t = await mk(sm, { title: "Old one" });
    await db.task.update({ where: { id: t.id }, data: { stage: "COMPLETED" } });
    await expect(mk(sm, { title: "Old one" })).resolves.toBeTruthy();
  });
  it("another organization never sees or clashes with the title", async () => { await expect(mk(outsider, { title: "Reel A" })).resolves.toBeTruthy(); });
});

describe("collaborators", () => {
  it("gives a collaborator visibility, 'mine' membership and a notification", async () => {
    expect(await getTask(editor, t1)).toBeNull(); // not involved yet
    await addCollaborator(sm, t1, editor.id);
    expect(await getTask(editor, t1)).not.toBeNull();
    expect((await listTasks(editor, { mine: true })).items.map((t) => t.id)).toContain(t1);
    expect(await db.notification.count({ where: { userId: editor.id, taskId: t1 } })).toBe(1);
    expect((await listCollaborators(sm, t1)).map((c) => c.userId)).toEqual([editor.id]);
  });
  it("rejects the accountable owner, duplicates, strangers, inactive users and other orgs", async () => {
    await expect(addCollaborator(sm, t1, video.id)).rejects.toThrow(/المسؤول/);
    await expect(addCollaborator(sm, t1, editor.id)).rejects.toThrow(/بالفعل/);
    await expect(addCollaborator(sm, t1, outsider.id)).rejects.toThrow(/غير موجود/);
    await expect(addCollaborator(designer, t1, designer.id)).rejects.toThrow(); // cannot see it
    await expect(addCollaborator(video, t1, designer.id)).rejects.toThrow(/صلاحية/); // owner cannot manage the team
    await db.user.update({ where: { id: designer.id }, data: { status: "DISABLED" } });
    await expect(addCollaborator(sm, t1, designer.id)).rejects.toThrow(/غير موجود/);
    await db.user.update({ where: { id: designer.id }, data: { status: "ACTIVE" } });
  });
  it("managers can remove; a collaborator may leave; others cannot", async () => {
    await expect(removeCollaborator(video, t1, editor.id)).rejects.toThrow();
    await removeCollaborator(editor, t1, editor.id);
    expect(await getTask(editor, t1)).toBeNull();
    await addCollaborator(mm, t1, editor.id);
    await removeCollaborator(mm, t1, editor.id);
    expect(await listCollaborators(sm, t1)).toEqual([]);
  });
});

describe("task checklist", () => {
  it("owner, collaborators and managers can work it; strangers cannot", async () => {
    await addTaskChecklistItem(video, t1, "  رفع الملفات الخام ");
    await addCollaborator(sm, t1, editor.id);
    await addTaskChecklistItem(editor, t1, "مراجعة الصوت");
    let items = await listTaskChecklist(sm, t1);
    expect(items.map((i) => [i.label, i.position])).toEqual([["رفع الملفات الخام", 0], ["مراجعة الصوت", 1]]);
    await setTaskChecklistDone(editor, items[0].id, true);
    items = await listTaskChecklist(sm, t1);
    expect([items[0].done, items[0].doneById]).toEqual([true, editor.id]);
    await setTaskChecklistDone(editor, items[0].id, false);
    expect((await listTaskChecklist(sm, t1))[0].doneById).toBeNull();
    await expect(addTaskChecklistItem(designer, t1, "x")).rejects.toThrow();
    await expect(setTaskChecklistDone(designer, items[0].id, true)).rejects.toThrow();
    await expect(setTaskChecklistDone(outsider, items[0].id, true)).rejects.toThrow();
    await expect(addTaskChecklistItem(sm, t1, "   ")).rejects.toThrow(/مطلوب/);
    await removeTaskChecklistItem(sm, items[1].id);
    expect(await listTaskChecklist(sm, t1)).toHaveLength(1);
  });
  it("is read-only once the task is published", async () => {
    const t = await mk(sm, { title: "Closed list" });
    await db.task.update({ where: { id: t.id }, data: { stage: "PUBLISHED" } });
    await expect(addTaskChecklistItem(sm, t.id, "late")).rejects.toThrow(/للقراءة فقط/);
  });
});

describe("list filters", () => {
  it("filters by work status, assignee, due date and paginates / returns all for the board", async () => {
    const past = new Date(Date.now() - 86400000);
    const a = await mk(sm, { title: "Late reel", assigneeId: video.id });
    await db.task.update({ where: { id: a.id }, data: { deadline: past, stage: "PRODUCTION" } });
    expect((await listTasks(sm, { due: "overdue" })).items.map((t) => t.id)).toContain(a.id);
    expect((await listTasks(sm, { workStatus: "IN_PROGRESS" })).items.map((t) => t.id)).toContain(a.id);
    expect((await listTasks(sm, { workStatus: "CHANGES_REQUESTED" })).items.map((t) => t.id)).not.toContain(a.id);
    await db.taskRevision.create({ data: { taskId: a.id, stage: "PRODUCTION", requestedBy: sm.id, notes: "أعد التصوير" } });
    expect((await listTasks(sm, { workStatus: "CHANGES_REQUESTED" })).items.map((t) => t.id)).toContain(a.id);
    expect((await listTasks(sm, { workStatus: "IN_PROGRESS" })).items.map((t) => t.id)).not.toContain(a.id);
    expect((await listTasks(sm, { assigneeId: video.id })).items.every((t) => t.currentAssigneeId === video.id)).toBe(true);
    expect((await listTasks(sm, { workStatus: "TODO" })).items.every((t) => ["IDEA", "BRIEF", "ASSIGNED"].includes(t.stage))).toBe(true);
    expect((await listTasks(sm, { due: "none" })).items.every((t) => t.deadline === null)).toBe(true);
    const all = await listTasks(sm, { all: true });
    expect(all.items.length).toBeGreaterThan(0);
    expect(PAGE_SIZE).toBeGreaterThan(0);
  });
  it("a video editor sees only tasks they own, created or collaborate on", async () => {
    const mine = (await listTasks(editor, { all: true })).items.map((t) => t.id);
    expect(mine).toEqual([t1]);
  });
});
