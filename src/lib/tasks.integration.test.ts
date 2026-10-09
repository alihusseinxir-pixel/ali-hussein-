import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { createTask, getTask, listTasks, assignTask, updateTask, deleteTask, TaskError, type Actor } from "./tasks";
import { taskInputSchema } from "./task-schema";
import { ForbiddenError } from "./rbac";

const tag = `t${Date.now()}`;
const input = (over: Record<string, string> = {}) => taskInputSchema.parse({ title: "Reel – test", contentType: "REEL", ...over });

let orgA: string, orgB: string;
let sm: Actor, mm: Actor, video: Actor, video2: Actor, designer: Actor, outsider: Actor, otherSm: Actor;

async function user(orgId: string, role: Actor["role"], n: string): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: orgId, name: n, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: orgId, role };
}

beforeAll(async () => {
  orgA = (await db.organization.create({ data: { name: "A", slug: `a-${tag}` } })).id;
  orgB = (await db.organization.create({ data: { name: "B", slug: `b-${tag}` } })).id;
  sm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm");
  otherSm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm2");
  mm = await user(orgA, "MARKETING_MANAGER", "mm");
  video = await user(orgA, "VIDEOGRAPHER", "video");
  video2 = await user(orgA, "VIDEOGRAPHER", "video2");
  designer = await user(orgA, "DESIGNER", "designer");
  outsider = await user(orgB, "ADMIN", "outsider");
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

describe("tasks (integration)", () => {
  it("generates sequential unique task codes, even concurrently", async () => {
    const made = await Promise.all(Array.from({ length: 8 }, () => createTask(sm, input())));
    const codes = new Set(made.map((t) => t.taskCode));
    expect(codes.size).toBe(8);
    expect([...codes][0]).toMatch(/^BASMA-\d{4}-\d{5}$/);
  });

  it("starts in BRIEF unassigned, ASSIGNED when assigned, and records ownership + activity", async () => {
    const a = await createTask(sm, input());
    expect(a.stage).toBe("BRIEF");
    const b = await createTask(sm, input({ assigneeId: video.id }));
    expect(b.stage).toBe("ASSIGNED");
    const full = await getTask(sm, b.id);
    expect(full?.assignments).toHaveLength(1);
    expect(full?.activityLogs.map((l) => l.action)).toEqual(expect.arrayContaining(["task.created", "task.assigned"]));
    expect(await db.notification.count({ where: { userId: video.id, taskId: b.id } })).toBe(1);
  });

  it("rejects wrong-role assignee for the content type", async () => {
    await expect(createTask(sm, input({ assigneeId: designer.id }))).rejects.toThrow(TaskError);
    await expect(createTask(sm, input({ contentType: "CAROUSEL", assigneeId: video.id }))).rejects.toThrow(TaskError);
  });

  it("production roles cannot create tasks", async () => {
    await expect(createTask(video, input())).rejects.toThrow(ForbiddenError);
  });

  it("isolates organizations", async () => {
    const t = await createTask(sm, input());
    expect(await getTask(outsider, t.id)).toBeNull();
    expect((await listTasks(outsider)).total).toBe(0);
    await expect(updateTask(outsider, t.id, input())).rejects.toThrow();
    await expect(deleteTask(outsider, t.id)).rejects.toThrow();
  });

  it("rejects brand/campaign/assignee from another org", async () => {
    const brand = await db.brand.create({ data: { organizationId: orgB, name: `foreign-${tag}` } });
    await expect(createTask(sm, input({ brandId: brand.id }))).rejects.toThrow(TaskError);
    await db.brand.delete({ where: { id: brand.id } });
    await expect(createTask(sm, input({ assigneeId: outsider.id }))).rejects.toThrow(TaskError);
  });

  it("production users only see tasks they own/owned/created", async () => {
    const t = await createTask(sm, input({ title: "Visible only to video", assigneeId: video.id }));
    expect(await getTask(video, t.id)).not.toBeNull();
    expect(await getTask(video2, t.id)).toBeNull();
    // after reassignment the previous owner keeps read access, the new one gains it
    await assignTask(mm, t.id, video2.id);
    expect(await getTask(video2, t.id)).not.toBeNull();
    expect(await getTask(video, t.id)).not.toBeNull();
    const list = await listTasks(video2, { mine: true });
    expect(list.items.map((i) => i.id)).toContain(t.id);
    expect((await listTasks(video, { mine: true })).items.map((i) => i.id)).not.toContain(t.id);
  });

  it("reassignment preserves history (never overwritten)", async () => {
    const t = await createTask(sm, input({ assigneeId: video.id }));
    await assignTask(sm, t.id, video2.id);
    const full = await getTask(sm, t.id);
    expect(full?.assignments).toHaveLength(2);
    expect(full?.assignments[0].releasedAt).not.toBeNull();
    expect(full?.assignments[1].releasedAt).toBeNull();
    expect(full?.currentAssigneeId).toBe(video2.id);
  });

  it("only creator (or manager) can edit; edits are logged", async () => {
    const t = await createTask(sm, input());
    await expect(updateTask(otherSm, t.id, input({ title: "Hijack" }))).rejects.toThrow(ForbiddenError);
    await updateTask(sm, t.id, input({ title: "Renamed", deadline: "2026-10-07T16:00" }));
    await updateTask(mm, t.id, input({ title: "Renamed again", deadline: "2026-10-08T16:00" }));
    const full = await getTask(sm, t.id);
    expect(full?.title).toBe("Renamed again");
    expect(full?.activityLogs.filter((l) => l.action === "task.deadline_changed")).toHaveLength(2);
  });

  it("validates deadline vs start date and filters overdue/search", async () => {
    await expect(createTask(sm, input({ startDate: "2026-10-10T10:00", deadline: "2026-10-09T10:00" }))).rejects.toThrow(TaskError);
    const late = await createTask(sm, input({ title: `Late ${tag}`, deadline: "2020-01-01T10:00" }));
    expect((await listTasks(sm, { overdue: true })).items.map((i) => i.id)).toContain(late.id);
    expect((await listTasks(sm, { q: `late ${tag}` })).total).toBe(1);
  });

  it("soft-deletes (hidden from lists, row kept) and only managers can", async () => {
    const t = await createTask(sm, input());
    await expect(deleteTask(sm, t.id)).rejects.toThrow(ForbiddenError);
    await deleteTask(mm, t.id);
    expect(await getTask(mm, t.id)).toBeNull();
    expect(await db.task.findUnique({ where: { id: t.id } })).not.toBeNull();
  });
});
