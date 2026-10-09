import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { createTask, type Actor } from "./tasks";
import { taskInputSchema } from "./task-schema";
import { changeScriptStatus, getScript, saveScenes } from "./script";

const tag = `sc${Date.now()}`;
let orgA: string, orgB: string;
let sm: Actor, mm: Actor, video: Actor, outsider: Actor;
let taskId: string;
const scene = (n: number) => ({ durationSec: n, shotDescription: `لقطة ${n}`, dialogue: `حوار ${n}` });

async function user(org: string, role: Actor["role"], n: string): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: org, name: n, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: org, role };
}
beforeAll(async () => {
  orgA = (await db.organization.create({ data: { name: "SA", slug: `sa-${tag}` } })).id;
  orgB = (await db.organization.create({ data: { name: "SB", slug: `sb-${tag}` } })).id;
  sm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm");
  mm = await user(orgA, "MARKETING_MANAGER", "mm");
  video = await user(orgA, "VIDEOGRAPHER", "video");
  outsider = await user(orgB, "ADMIN", "out");
  taskId = (await createTask(sm, taskInputSchema.parse({ title: "Script test", contentType: "REEL", hook: "جذب", contentPillar: "توعية" }))).id;
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

describe("script scenes (integration)", () => {
  it("stores hook and content pillar on the task", async () => {
    const t = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect([t.hook, t.contentPillar, t.scriptStatus]).toEqual(["جذب", "توعية", "DRAFT"]);
  });
  it("saves, reorders and deletes scenes with contiguous positions and a revision per save", async () => {
    let v = (await saveScenes(sm, taskId, [scene(1), scene(2), scene(3)], 0)).version;
    expect(v).toBe(1);
    v = (await saveScenes(sm, taskId, [scene(3), scene(1)], v)).version;
    const s = await getScript(sm, taskId);
    expect(s.scenes.map((x) => [x.position, x.durationSec])).toEqual([[0, 3], [1, 1]]);
    expect(s.revisions.map((r) => r.version)).toEqual([2, 1]);
  });
  it("validates required fields and trims", async () => {
    await expect(saveScenes(sm, taskId, [{ shotDescription: "   " }], 2)).rejects.toThrow(/المشهد 1/);
    await expect(saveScenes(sm, taskId, [{ shotDescription: "x", durationSec: -1 }], 2)).rejects.toThrow();
    expect((await getScript(sm, taskId)).version).toBe(2); // failed saves leave no revision
  });
  it("rejects a stale version (optimistic concurrency)", async () => {
    await expect(saveScenes(sm, taskId, [scene(9)], 1)).rejects.toThrow(/شخص آخر/);
  });
  it("blocks users who cannot edit the task, and other organizations", async () => {
    await expect(saveScenes(mm, taskId, [scene(1)], 2)).resolves.toBeTruthy(); // marketing manager: task:edit:any
    await expect(saveScenes(video, taskId, [scene(1)], 3)).rejects.toBeTruthy(); // cannot even see it
    await expect(saveScenes(outsider, taskId, [scene(1)], 3)).rejects.toThrow();
    await expect(getScript(outsider, taskId)).rejects.toThrow();
  });
  it("review flow: approval is never implied, scenes lock, changes need a note, edits after changes restart review", async () => {
    let v = (await getScript(sm, taskId)).version;
    await expect(changeScriptStatus(sm, taskId, "APPROVED", null, v)).rejects.toThrow(); // not allowed from DRAFT
    v = (await changeScriptStatus(sm, taskId, "IN_REVIEW", null, v)).version;
    await expect(saveScenes(sm, taskId, [scene(1)], v)).rejects.toThrow(/مقفل/); // locked while in review
    await expect(changeScriptStatus(video, taskId, "APPROVED", null, v)).rejects.toBeTruthy();
    await expect(changeScriptStatus(mm, taskId, "CHANGES_REQUESTED", " ", v)).rejects.toThrow(/ملاحظات/);
    v = (await changeScriptStatus(mm, taskId, "CHANGES_REQUESTED", "غيّر المشهد الأول", v)).version;
    expect(await db.notification.count({ where: { taskId, userId: sm.id, type: "REVISION_REQUESTED" } })).toBe(1);
    v = (await saveScenes(sm, taskId, [scene(5), scene(6)], v)).version; // editable again
    v = (await changeScriptStatus(sm, taskId, "IN_REVIEW", null, v)).version;
    v = (await changeScriptStatus(mm, taskId, "APPROVED", null, v)).version;
    await expect(saveScenes(sm, taskId, [scene(1)], v)).rejects.toThrow(/مقفل/);
    v = (await changeScriptStatus(mm, taskId, "READY_FOR_PRODUCTION", null, v)).version;
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).scriptStatus).toBe("READY_FOR_PRODUCTION");
    expect(await db.activityLog.count({ where: { taskId, action: "script.status" } })).toBe(5);
    expect((await getScript(sm, taskId)).revisions[0].action).toBe("status:READY_FOR_PRODUCTION");
  });
  it("cannot send an empty script to review", async () => {
    const t2 = (await createTask(sm, taskInputSchema.parse({ title: "Empty", contentType: "REEL" }))).id;
    await expect(changeScriptStatus(sm, t2, "IN_REVIEW", null, 0)).rejects.toThrow(/مشهداً/);
  });
  it("only one of two simultaneous status changes wins", async () => {
    const t3 = (await createTask(sm, taskInputSchema.parse({ title: "Race", contentType: "REEL" }))).id;
    const v = (await saveScenes(sm, t3, [scene(1)], 0)).version;
    const r = await Promise.allSettled([changeScriptStatus(sm, t3, "IN_REVIEW", null, v), changeScriptStatus(mm, t3, "IN_REVIEW", null, v)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });
});
