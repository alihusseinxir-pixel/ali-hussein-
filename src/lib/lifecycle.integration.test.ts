import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { env } from "./env";
import { assignTask, createTask, getTask, type Actor } from "./tasks";
import { taskInputSchema } from "./task-schema";
import { handoverSchema } from "./handover-schema";
import { acceptHandover, submitHandover } from "./handover";
import { uploadFile } from "./files";
import { changeScriptStatus, createTaskFromScene, getScript, saveScenes } from "./script";
import { createShoot, getShoot, setShootStatus } from "./shoots";
import { createLocation, createTalent } from "./shoot-resources";
import { listTaskChecklist, setTaskChecklistDone } from "./task-team";
import { dashboardExtras } from "./dashboard";
import { listCalendarItems } from "./calendar-query";
import { toLocalInput } from "./datetime";

/** One content item, idea → completed, touching every module and checking that approvals are never implied. */
const tag = `lc${Date.now()}`;
let org: string;
let sm: Actor, mm: Actor, video: Actor, editor: Actor;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0];
const up = (a: Actor, taskId: string, kind: string, name: string) => uploadFile(a, taskId, new File([new Uint8Array(PNG)], name, { type: "image/png" }), kind);
const ho = (o: Record<string, string>) => handoverSchema.parse(o);
const pending = async (a: Actor, taskId: string) => (await db.taskHandoff.findFirstOrThrow({ where: { taskId, toUserId: a.id, status: "PENDING" } })).id;
const stage = async (id: string) => (await db.task.findUniqueOrThrow({ where: { id } })).stage;
const local = (d: Date) => toLocalInput(d, env.timezone);
const inH = (h: number) => new Date(Date.now() + h * 3600_000);

async function user(role: Actor["role"], n: string): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: org, name: n, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: org, role };
}
beforeAll(async () => {
  org = (await db.organization.create({ data: { name: "LC", slug: `lc-${tag}` } })).id;
  sm = await user("SOCIAL_MEDIA_MANAGER", "sm"); mm = await user("MARKETING_MANAGER", "mm");
  video = await user("VIDEOGRAPHER", "video"); editor = await user("VIDEO_EDITOR", "editor");
});
afterAll(async () => {
  await db.activityLog.deleteMany({ where: { organizationId: org } });
  await db.notification.deleteMany({ where: { organizationId: org } });
  await db.shootSession.deleteMany({ where: { organizationId: org } });
  await db.talent.deleteMany({ where: { organizationId: org } });
  await db.location.deleteMany({ where: { organizationId: org } });
  await db.task.deleteMany({ where: { organizationId: org } });
  await db.taskCounter.deleteMany({ where: { organizationId: org } });
  await db.user.deleteMany({ where: { organizationId: org } });
  await db.organization.delete({ where: { id: org } });
  await db.$disconnect();
});

describe("full lifecycle: idea → script → shoot → edit → approvals → published", () => {
  let taskId: string, shootId: string;

  it("1. idea: a content item is created with its own record and no approvals", async () => {
    const t = await createTask(sm, taskInputSchema.parse({ title: "ريل المنتج الجديد", contentType: "REEL", platform: "INSTAGRAM", hook: "هل جربت هذا؟", contentPillar: "منتج", publishAt: local(inH(72)), deadline: local(inH(48)) }));
    taskId = t.id;
    expect(t.stage).toBe("BRIEF");
    expect(t.scriptStatus).toBe("DRAFT");
    expect(await db.taskApproval.count({ where: { taskId } })).toBe(0);
    // due date and publishing date are separate fields
    expect(t.deadline).not.toEqual(t.publishAt);
  });

  it("2. script: written scene by scene, reviewed, sent back, fixed and approved only by a reviewer", async () => {
    let v = (await saveScenes(sm, taskId, [{ shotDescription: "لقطة قريبة", durationSec: 3 }, { shotDescription: "ظهور المودل", durationSec: 5 }, { shotDescription: "لقطة ختامية", durationSec: 4 }], 0)).version;
    await expect(changeScriptStatus(sm, taskId, "APPROVED", null, v)).rejects.toThrow(); // the author cannot skip review
    v = (await changeScriptStatus(sm, taskId, "IN_REVIEW", null, v)).version;
    v = (await changeScriptStatus(mm, taskId, "CHANGES_REQUESTED", "قصّر المشهد الثاني", v)).version;
    v = (await saveScenes(sm, taskId, [{ shotDescription: "لقطة قريبة", durationSec: 3 }, { shotDescription: "ظهور المودل", durationSec: 3 }, { shotDescription: "لقطة ختامية", durationSec: 4 }], v)).version;
    v = (await changeScriptStatus(sm, taskId, "IN_REVIEW", null, v)).version;
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).scriptStatus).toBe("IN_REVIEW"); // still not approved
    v = (await changeScriptStatus(mm, taskId, "APPROVED", null, v)).version;
    v = (await changeScriptStatus(mm, taskId, "READY_FOR_PRODUCTION", null, v)).version;
    const s = await getScript(sm, taskId);
    expect(s.task.scriptStatus).toBe("READY_FOR_PRODUCTION");
    expect(s.revisions.map((r) => r.action).reverse()).toEqual(["saved", "status:IN_REVIEW", "status:CHANGES_REQUESTED", "saved", "status:IN_REVIEW", "status:APPROVED", "status:READY_FOR_PRODUCTION"]);
    expect(s.revisions.find((r) => r.action === "status:APPROVED")?.actorName).toBe("mm"); // who approved is recorded
  });

  it("3. shoot: planned with crew, model, location; no warnings, no blockers", async () => {
    const loc = (await createLocation(mm, { name: "الاستوديو", address: "الرياض", mapUrl: "https://maps.example/x" })).id;
    const model = (await createTalent(mm, { name: "سارة", phone: "0500000000" })).id;
    shootId = (await createShoot(mm, { title: "تصوير الريل", startsAt: local(inH(10)), endsAt: local(inH(13)), callTime: local(inH(9)),
      locationId: loc, videographerId: video.id, talentIds: [model], taskIds: [taskId], requiredItems: "المنتج + إكسسوارات", shotList: "1) قريبة 2) المودل 3) ختام" })).id;
    expect((await getShoot(mm, shootId))!.warnings).toEqual([]);
    const x = await dashboardExtras(sm);
    expect(x.blockers.filter((b) => b.kind === "shoot-script" || b.kind === "shoot-warnings")).toEqual([]);
    expect((await listCalendarItems(video, { from: inH(0), to: inH(24) })).some((e) => e.id === `shoot:${shootId}`)).toBe(true);
  });

  it("4. scenes become sub-tasks that the crew works through", async () => {
    for (const n of [1, 2, 3]) await createTaskFromScene(sm, taskId, n);
    await assignTask(sm, taskId, video.id);
    for (const item of await listTaskChecklist(video, taskId)) await setTaskChecklistDone(video, item.id, true);
    const list = await listTaskChecklist(sm, taskId);
    expect(list.map((i) => i.sourceSceneNumber)).toEqual([1, 2, 3]);
    expect(list.every((i) => i.done && i.doneById === video.id)).toBe(true);
  });

  it("5. production → review → editing → approvals → completed, every approval recorded", async () => {
    await acceptHandover(video, await pending(video, taskId));
    expect(await stage(taskId)).toBe("PRODUCTION");
    await setShootStatus(mm, shootId, "COMPLETED");
    await up(video, taskId, "RAW", "Raw_01.png");
    await submitHandover(video, taskId, ho({ toUserId: mm.id, instructions: "راجع اللقطات", deliverables: "Raw_01", deadline: local(inH(14)) }));
    await acceptHandover(mm, await pending(mm, taskId));
    await submitHandover(mm, taskId, ho({ toUserId: editor.id, instructions: "قص 30 ثانية", deadline: local(inH(20)) }));
    await acceptHandover(editor, await pending(editor, taskId));
    await up(editor, taskId, "FINAL", "Final.png");
    await submitHandover(editor, taskId, ho({ toUserId: mm.id, instructions: "راجع النسخة", deliverables: "Final_V1", deadline: local(inH(30)) }));
    await acceptHandover(mm, await pending(mm, taskId));
    expect(await stage(taskId)).toBe("EDITING_REVIEW");
    // nobody can jump to scheduled/published without passing each approval stage
    await expect(submitHandover(editor, taskId, ho({ toUserId: sm.id }))).rejects.toThrow();
    await submitHandover(mm, taskId, ho({ toUserId: mm.id, deadline: local(inH(31)) }));
    await submitHandover(mm, taskId, ho({ toUserId: sm.id, instructions: "موافقة نهائية", deadline: local(inH(32)) }));
    await acceptHandover(sm, await pending(sm, taskId));
    expect(await stage(taskId)).toBe("SOCIAL_APPROVAL");
    await submitHandover(sm, taskId, ho({ toUserId: sm.id }));
    expect(await stage(taskId)).toBe("SCHEDULED");
    await submitHandover(sm, taskId, ho({ toUserId: sm.id }));
    expect(await stage(taskId)).toBe("PUBLISHED");
    await submitHandover(sm, taskId, ho({ toUserId: sm.id }));
    expect(await stage(taskId)).toBe("COMPLETED");
  });

  it("6. the audit trail and approvals tell the whole story; finished work is read-only", async () => {
    const approvals = await db.taskApproval.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
    expect(approvals.length).toBeGreaterThanOrEqual(4);
    expect(approvals.every((a) => a.status === "APPROVED" && [mm.id, sm.id].includes(a.approverId))).toBe(true); // only reviewers approve
    const actions = new Set((await db.activityLog.findMany({ where: { organizationId: org } })).map((a) => a.action));
    for (const a of ["task.created", "script.saved", "script.status", "script.scene_task_created", "shoot.created", "shoot.completed", "handover.created", "task.approved"]) expect(actions).toContain(a);
    await expect(saveScenes(sm, taskId, [{ shotDescription: "x" }], 0)).rejects.toThrow();
    const full = await getTask(sm, taskId);
    expect(full?.stage).toBe("COMPLETED");
    expect(full?.scriptStatus).toBe("READY_FOR_PRODUCTION"); // the script status was never changed by workflow moves
    const x = await dashboardExtras(sm);
    expect(x.overdue.map((t) => t.id)).not.toContain(taskId);
    expect(x.approvals.map((t) => t.id)).not.toContain(taskId);
  });
});
