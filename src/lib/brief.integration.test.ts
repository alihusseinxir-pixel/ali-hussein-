import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { createTask, type Actor } from "./tasks";
import { loadBriefData } from "./brief";
import { createShareLink, parseToken, resolveShareToken, revokeShareLinks } from "./brief-share";
import { taskInputSchema } from "./task-schema";
import { ForbiddenError } from "./rbac";

const tag = `b${Date.now()}`;
let orgA: string, orgB: string;
let sm: Actor, sm2: Actor, mm: Actor, video: Actor, video2: Actor, outsider: Actor;
let taskId: string;

async function user(org: string, role: Actor["role"], n: string, name = n): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: org, name, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: org, role };
}
const tokenOf = (url: string) => url.split("/share/brief/")[1];

beforeAll(async () => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "s".repeat(40);
  orgA = (await db.organization.create({ data: { name: "BriefCo", slug: `brA-${tag}` } })).id;
  orgB = (await db.organization.create({ data: { name: "Other", slug: `brB-${tag}` } })).id;
  sm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm", "Sama");
  sm2 = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm2");
  mm = await user(orgA, "MARKETING_MANAGER", "mm");
  video = await user(orgA, "VIDEOGRAPHER", "video", "أحمد");
  video2 = await user(orgA, "VIDEOGRAPHER", "video2");
  outsider = await user(orgB, "ADMIN", "out");
  taskId = (await createTask(sm, taskInputSchema.parse({ title: "Brief task", contentType: "REEL", assigneeId: video.id, script: "SCENE 01 – open", shootingAt: "2026-10-07T16:00" }))).id;
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

describe("brief data + share links (integration)", () => {
  it("collects task data, dates in the org timezone and the whole team", async () => {
    const r = await loadBriefData({ actor: sm, taskId });
    expect(r?.data.taskCode).toMatch(/^BASMA-\d{4}-\d{5}$/);
    expect(r?.data.shooting).toContain("4:00");
    expect(r?.data.orgName).toBe("BriefCo");
    expect(r?.data.team.map((t) => t.name)).toEqual(expect.arrayContaining(["Sama", "أحمد"]));
  });

  it("only people who can see the task can generate it; other organizations never", async () => {
    expect(await loadBriefData({ actor: video, taskId })).not.toBeNull();
    expect(await loadBriefData({ actor: video2, taskId })).toBeNull();
    expect(await loadBriefData({ actor: outsider, taskId })).toBeNull();
  });

  it("only the creator or a manager may create/revoke share links", async () => {
    await expect(createShareLink(video, taskId, 7)).rejects.toThrow(ForbiddenError);
    await expect(createShareLink(sm2, taskId, 7)).rejects.toThrow(ForbiddenError); // another social manager, not creator
    await expect(createShareLink(outsider, taskId, 7)).rejects.toThrow(/غير موجود/);
    await expect(revokeShareLinks(video, taskId)).rejects.toThrow(ForbiddenError);
    const l = await createShareLink(mm, taskId, 7);
    expect(l.url).toContain("/share/brief/");
  });

  it("links resolve to the task, clamp their lifetime, and stop working once revoked", async () => {
    const a = await createShareLink(sm, taskId, 9999);
    expect(a.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 864e5 + 5000);
    expect(await resolveShareToken(tokenOf(a.url))).toEqual({ taskId, organizationId: orgA });
    expect(await resolveShareToken(tokenOf(a.url) + "x")).toBeNull();
    await revokeShareLinks(sm, taskId);
    expect(await resolveShareToken(tokenOf(a.url))).toBeNull(); // revoked
    const b = await createShareLink(sm, taskId, 1); // a fresh link works after revocation
    expect(await resolveShareToken(tokenOf(b.url))).not.toBeNull();
    expect(parseToken(tokenOf(b.url))?.taskId).toBe(taskId);
    const actions = (await db.activityLog.findMany({ where: { taskId } })).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(["brief.shared", "brief.share_revoked"]));
  });

  it("deleted tasks cannot be reached through an old link", async () => {
    const l = await createShareLink(sm, taskId, 1);
    await db.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
    expect(await resolveShareToken(tokenOf(l.url))).toBeNull();
    await db.task.update({ where: { id: taskId }, data: { deletedAt: null } });
  });
});
