import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { env } from "./env";
import { createTask, type Actor } from "./tasks";
import { taskInputSchema } from "./task-schema";
import { toLocalInput } from "./datetime";
import { dayKey } from "./calendar";
import { createTaskFromScene, getScript, saveScenes } from "./script";
import { createShoot, setShootStatus } from "./shoots";
import { addCollaborator } from "./task-team";
import { listCalendarItems } from "./calendar-query";
import { dashboardExtras } from "./dashboard";

const tag = `wi${Date.now()}`;
let orgA: string, orgB: string;
let sm: Actor, mm: Actor, photo: Actor, video: Actor, designer: Actor, outsider: Actor;
let taskId: string;
const local = (d: Date) => toLocalInput(d, env.timezone);
const inH = (h: number) => new Date(Date.now() + h * 3600_000);

async function user(org: string, role: Actor["role"], n: string): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: org, name: n, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: org, role };
}
const mk = (a: Actor, over: Record<string, unknown> = {}) => createTask(a, taskInputSchema.parse({ title: `T ${Math.random()}`, contentType: "REEL", ...over }));

beforeAll(async () => {
  orgA = (await db.organization.create({ data: { name: "WA", slug: `wa-${tag}` } })).id;
  orgB = (await db.organization.create({ data: { name: "WB", slug: `wb-${tag}` } })).id;
  sm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm");
  mm = await user(orgA, "MARKETING_MANAGER", "mm");
  photo = await user(orgA, "PHOTOGRAPHER", "photo");
  video = await user(orgA, "VIDEOGRAPHER", "video");
  designer = await user(orgA, "DESIGNER", "designer");
  outsider = await user(orgB, "ADMIN", "out");
  taskId = (await mk(sm, { title: "Scene source", assigneeId: video.id })).id;
  await saveScenes(sm, taskId, [{ shotDescription: "لقطة قريبة للمنتج" }, { shotDescription: "x".repeat(300) }], 0);
});
afterAll(async () => {
  for (const org of [orgA, orgB]) {
    await db.activityLog.deleteMany({ where: { organizationId: org } });
    await db.notification.deleteMany({ where: { organizationId: org } });
    await db.shootSession.deleteMany({ where: { organizationId: org } });
    await db.location.deleteMany({ where: { organizationId: org } });
    await db.task.deleteMany({ where: { organizationId: org } });
    await db.taskCounter.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { organizationId: org } });
    await db.organization.delete({ where: { id: org } });
  }
  await db.$disconnect();
});

describe("tasks from script scenes", () => {
  it("creates one linked sub-task per scene, truncating long shots", async () => {
    await createTaskFromScene(sm, taskId, 1);
    await createTaskFromScene(video, taskId, 2); // the owner can too
    const items = await db.taskChecklistItem.findMany({ where: { taskId }, orderBy: { position: "asc" } });
    expect(items.map((i) => i.sourceSceneNumber)).toEqual([1, 2]);
    expect(items[0].label).toBe("المشهد 1: لقطة قريبة للمنتج");
    expect(items[1].label.length).toBeLessThanOrEqual(130);
    expect((await getScript(sm, taskId)).linked.map((l) => l.scene)).toEqual([1, 2]);
    expect(await db.activityLog.count({ where: { taskId, action: "script.scene_task_created" } })).toBe(2);
  });
  it("rejects duplicates, unsaved scenes, strangers and other organizations", async () => {
    await expect(createTaskFromScene(sm, taskId, 1)).rejects.toThrow(/بالفعل/);
    await expect(createTaskFromScene(sm, taskId, 3)).rejects.toThrow(/غير موجود/);
    await expect(createTaskFromScene(sm, taskId, 0)).rejects.toThrow();
    await expect(createTaskFromScene(designer, taskId, 1)).rejects.toThrow();
    await expect(createTaskFromScene(outsider, taskId, 1)).rejects.toThrow();
  });
  it("a collaborator may create scene tasks but only for scenes without one", async () => {
    const t = (await mk(sm, { title: "Collab scenes" })).id;
    await saveScenes(sm, t, [{ shotDescription: "a" }], 0);
    await addCollaborator(sm, t, designer.id);
    await createTaskFromScene(designer, t, 1);
    await expect(createTaskFromScene(designer, t, 1)).rejects.toThrow(/بالفعل/);
  });
});

describe("calendar and dashboard integration", () => {
  let shootId: string;
  const range = { from: inH(-48), to: inH(24 * 8) };
  it("shows shoot sessions in the calendar for managers and their own crew only", async () => {
    const s = await createShoot(sm, { title: "جلسة اليوم", startsAt: local(inH(1)), endsAt: local(inH(3)), photographerId: photo.id, taskIds: [taskId] });
    shootId = s.id;
    expect((await listCalendarItems(sm, range)).some((e) => e.id === `shoot:${shootId}` && e.href === `/shoots/${shootId}`)).toBe(true);
    expect((await listCalendarItems(photo, range)).some((e) => e.id === `shoot:${shootId}`)).toBe(true);
    expect((await listCalendarItems(video, range)).some((e) => e.id === `shoot:${shootId}`)).toBe(false);
    expect((await listCalendarItems(sm, { ...range, mine: true })).some((e) => e.id === `shoot:${shootId}`)).toBe(false); // sm is not crew
    expect((await listCalendarItems(sm, { ...range, types: ["PUBLISHING"] })).some((e) => e.id === `shoot:${shootId}`)).toBe(false);
    expect((await listCalendarItems(outsider, range)).some((e) => e.id === `shoot:${shootId}`)).toBe(false);
  });
  it("lists today's shoots and flags a shoot whose script is not approved", async () => {
    const x = await dashboardExtras(sm);
    if (dayKey(inH(1), env.timezone) === dayKey(new Date(), env.timezone)) expect(x.todayShoots.map((s) => s.id)).toContain(shootId);
    const msgs = x.blockers.map((b) => b.message).join("\n");
    expect(msgs).toContain("جلسة اليوم"); expect(msgs).toContain("غير معتمد"); expect(msgs).toContain("Scene source");
  });
  it("stops flagging the script once it is approved, and drops cancelled shoots from the calendar", async () => {
    await db.task.update({ where: { id: taskId }, data: { scriptStatus: "APPROVED" } });
    expect((await dashboardExtras(sm)).blockers.some((b) => b.kind === "shoot-script")).toBe(false);
    await setShootStatus(sm, shootId, "CANCELLED");
    expect((await listCalendarItems(sm, range)).some((e) => e.id === `shoot:${shootId}`)).toBe(false);
  });
  it("counts overdue tasks, pending approvals, upcoming publishing, changes requested and workload", async () => {
    const a = await mk(sm, { title: "Late", assigneeId: video.id });
    await db.task.update({ where: { id: a.id }, data: { deadline: inH(-5), stage: "PRODUCTION" } });
    await db.taskRevision.create({ data: { taskId: a.id, stage: "PRODUCTION", requestedBy: sm.id, notes: "n" } });
    const b = await mk(sm, { title: "Needs approval" });
    await db.task.update({ where: { id: b.id }, data: { stage: "SOCIAL_APPROVAL", publishAt: inH(48) } });
    const x = await dashboardExtras(sm);
    expect(x.overdue.map((t) => t.id)).toContain(a.id);
    expect(x.overdueTotal).toBeGreaterThanOrEqual(1);
    expect(x.approvals.map((t) => t.id)).toContain(b.id);
    expect(x.publishing.map((t) => t.id)).toContain(b.id);
    expect(x.blockers.some((bl) => bl.kind === "changes" && bl.href === `/tasks/${a.id}`)).toBe(true);
    const w = x.workload.find((r) => r.name === "video")!;
    expect(w.open).toBeGreaterThanOrEqual(2); expect(w.overdue).toBe(1);
  });
  it("production roles see only their own numbers and no team workload; other orgs see nothing", async () => {
    const x = await dashboardExtras(video);
    expect(x.workload).toEqual([]);
    expect(x.overdue.every((t) => t.currentAssignee?.id === video.id)).toBe(true);
    expect(x.todayShoots).toEqual([]); // video is not on any shoot
    const y = await dashboardExtras(outsider);
    expect([y.overdueTotal, y.approvalsTotal, y.blockers.length, y.workload.length]).toEqual([0, 0, 0, 0]);
    expect((await dashboardExtras(mm)).workload.length).toBeGreaterThan(0);
  });
});
