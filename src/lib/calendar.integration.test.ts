import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { assignTask, createTask, deleteTask, updateTask, type Actor } from "./tasks";
import { listCalendarEvents } from "./calendar-query";
import { acceptHandover, submitHandover } from "./handover";
import { uploadFile } from "./files";
import { taskInputSchema } from "./task-schema";
import { handoverSchema } from "./handover-schema";

const tag = `cal${Date.now()}`;
let orgA: string, orgB: string;
let sm: Actor, mm: Actor, video: Actor, video2: Actor, editor: Actor, outsider: Actor;
const range = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z") };
const events = (a: Actor, o: object = {}) => listCalendarEvents(a, { ...range, ...o });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);

async function user(org: string, role: Actor["role"], n: string): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: org, name: n, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: org, role };
}
beforeAll(async () => {
  orgA = (await db.organization.create({ data: { name: "CalA", slug: `cala-${tag}` } })).id;
  orgB = (await db.organization.create({ data: { name: "CalB", slug: `calb-${tag}` } })).id;
  sm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm");
  mm = await user(orgA, "MARKETING_MANAGER", "mm");
  video = await user(orgA, "VIDEOGRAPHER", "video");
  video2 = await user(orgA, "VIDEOGRAPHER", "video2");
  editor = await user(orgA, "VIDEO_EDITOR", "editor");
  outsider = await user(orgB, "ADMIN", "out");
});
afterAll(async () => {
  for (const org of [orgA, orgB]) {
    await db.calendarEvent.deleteMany({ where: { organizationId: org } });
    await db.activityLog.deleteMany({ where: { organizationId: org } });
    await db.notification.deleteMany({ where: { organizationId: org } });
    await db.task.deleteMany({ where: { organizationId: org } });
    await db.taskCounter.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { organizationId: org } });
    await db.organization.delete({ where: { id: org } });
  }
  await db.$disconnect();
});

describe("calendar (integration)", () => {
  let taskId: string;
  it("creates shooting / deadline / publishing events automatically, in the org timezone", async () => {
    const t = await createTask(sm, taskInputSchema.parse({ title: "Cal reel", contentType: "REEL", assigneeId: video.id, shootingAt: "2026-10-07T16:00", deadline: "2026-10-08T12:00", publishAt: "2026-10-10T20:00" }));
    taskId = t.id;
    const ev = (await events(sm)).filter((e) => e.task.id === taskId);
    expect(ev.map((e) => e.type).sort()).toEqual(["PUBLISHING", "SHOOTING", "SHOOTING"]);
    expect(ev.find((e) => e.title.startsWith("Shooting"))?.startsAt.toISOString()).toBe("2026-10-07T13:00:00.000Z"); // 16:00 Riyadh
    expect(ev.find((e) => e.title.startsWith("Shooting"))?.userName).toBe("video");
  });

  it("follows the task: edits move events, reassignment changes the person, handover changes the type", async () => {
    await updateTask(sm, taskId, taskInputSchema.parse({ title: "Cal reel", contentType: "REEL", shootingAt: "2026-10-07T18:00", deadline: "2026-10-08T12:00", publishAt: "2026-10-10T20:00" }));
    expect((await events(sm)).find((e) => e.title.startsWith("Shooting"))?.startsAt.toISOString()).toBe("2026-10-07T15:00:00.000Z");

    await assignTask(sm, taskId, video2.id);
    expect((await events(sm)).filter((e) => e.task.id === taskId).every((e) => e.type === "PUBLISHING" || e.userName === "video2")).toBe(true);

    await acceptHandover(video2, (await db.taskHandoff.findFirstOrThrow({ where: { taskId, toUserId: video2.id, status: "PENDING" } })).id);
    await uploadFile(video2, taskId, new File([PNG], "raw.png"), "RAW");
    await submitHandover(video2, taskId, handoverSchema.parse({ toUserId: mm.id, instructions: "r", deliverables: "d", deadline: "2026-10-09T09:00" }));
    const ev = (await events(sm)).filter((e) => e.task.id === taskId);
    const due = ev.find((e) => e.title.startsWith("Due"))!;
    expect(due.type).toBe("REVIEW");
    expect(due.userName).toBe("mm");
    expect(due.startsAt.toISOString()).toBe("2026-10-09T06:00:00.000Z");
    expect(ev.filter((e) => e.title.startsWith("Due"))).toHaveLength(1); // rebuilt, never duplicated
  });

  it("restricts who sees which events", async () => {
    expect((await events(video2)).some((e) => e.task.id === taskId)).toBe(true); // owned it → has the shooting event
    expect((await events(video)).filter((e) => e.task.id === taskId)).toHaveLength(0); // no longer assigned to any event
    expect(await events(outsider)).toHaveLength(0);
    expect((await events(sm, { mine: true })).filter((e) => e.task.id === taskId).every((e) => e.userName === "sm")).toBe(true);
    expect((await events(sm, { types: ["PUBLISHING"] })).every((e) => e.type === "PUBLISHING")).toBe(true);
  });

  it("only returns events inside the requested range and removes them when the task is deleted", async () => {
    expect((await listCalendarEvents(sm, { from: new Date("2026-12-01Z"), to: new Date("2027-01-01Z") }))).toHaveLength(0);
    await deleteTask(mm, taskId);
    expect((await events(sm)).filter((e) => e.task.id === taskId)).toHaveLength(0);
    expect(await db.calendarEvent.count({ where: { taskId } })).toBe(0);
  });
});
