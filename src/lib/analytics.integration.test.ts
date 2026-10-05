import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { createTask, type Actor } from "./tasks";
import { acceptHandover, requestChanges, submitHandover } from "./handover";
import { uploadFile } from "./files";
import { loadAnalytics } from "./analytics";
import { taskInputSchema } from "./task-schema";
import { handoverSchema } from "./handover-schema";

const tag = `an${Date.now()}`;
let orgA: string, orgB: string;
let sm: Actor, mm: Actor, video: Actor, editor: Actor, outsider: Actor;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
const ho = (o: Record<string, string>) => handoverSchema.parse(o);
const pend = async (a: Actor, taskId: string) => (await db.taskHandoff.findFirstOrThrow({ where: { taskId, toUserId: a.id, status: "PENDING" } })).id;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function user(org: string, role: Actor["role"], n: string): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: org, name: n, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: org, role };
}
beforeAll(async () => {
  orgA = (await db.organization.create({ data: { name: "AnA", slug: `ana-${tag}` } })).id;
  orgB = (await db.organization.create({ data: { name: "AnB", slug: `anb-${tag}` } })).id;
  sm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm");
  mm = await user(orgA, "MARKETING_MANAGER", "mm");
  video = await user(orgA, "VIDEOGRAPHER", "video");
  editor = await user(orgA, "VIDEO_EDITOR", "editor");
  outsider = await user(orgB, "ADMIN", "out");
  const brand = await db.brand.create({ data: { organizationId: orgA, name: "B" } });
  const camp = await db.campaign.create({ data: { organizationId: orgA, brandId: brand.id, name: "Camp" } });

  const t = await createTask(sm, taskInputSchema.parse({ title: "Flow", contentType: "REEL", assigneeId: video.id, publishAt: "2026-12-10T20:00", campaignId: camp.id }));
  await acceptHandover(video, await pend(video, t.id));
  await uploadFile(video, t.id, new File([PNG], "raw.png"), "RAW");
  await wait(20);
  await submitHandover(video, t.id, ho({ toUserId: mm.id, instructions: "r", deliverables: "d", deadline: "2026-12-08T12:00" }));
  await acceptHandover(mm, await pend(mm, t.id));
  await submitHandover(mm, t.id, ho({ toUserId: editor.id, instructions: "cut", deadline: "2026-12-09T12:00" }));
  await acceptHandover(editor, await pend(editor, t.id));
  await uploadFile(editor, t.id, new File([PNG], "final.png"), "FINAL");
  await wait(20);
  await submitHandover(editor, t.id, ho({ toUserId: mm.id, instructions: "v1", deliverables: "v1", deadline: "2026-12-09T18:00" }));
  await acceptHandover(mm, await pend(mm, t.id));
  await requestChanges(mm, t.id, "Change the first 3 seconds.");
  await acceptHandover(editor, await pend(editor, t.id));
  await uploadFile(editor, t.id, new File([PNG], "final.png"), "FINAL");
  await submitHandover(editor, t.id, ho({ toUserId: mm.id, instructions: "v2", deliverables: "v2", deadline: "2026-12-09T20:00" }));
  await acceptHandover(mm, await pend(mm, t.id));
  await submitHandover(mm, t.id, ho({ toUserId: sm.id, instructions: "approve", deadline: "2026-12-09T21:00" })); // EDITING_REVIEW → INTERNAL_APPROVAL (owner sm)
  await acceptHandover(sm, await pend(sm, t.id));
  await submitHandover(sm, t.id, ho({ toUserId: sm.id, deadline: "2026-12-09T22:00" })); // INTERNAL_APPROVAL → SOCIAL_APPROVAL
  await submitHandover(sm, t.id, ho({ toUserId: sm.id })); // → SCHEDULED
  await submitHandover(sm, t.id, ho({ toUserId: sm.id })); // → PUBLISHED

  // an extra open, overdue task owned by the videographer, and a fresh unassigned one
  await createTask(sm, taskInputSchema.parse({ title: "Late", contentType: "REEL", assigneeId: video.id, deadline: "2026-01-01T10:00" }));
  await createTask(sm, taskInputSchema.parse({ title: "Story", contentType: "STORY" }));
});
afterAll(async () => {
  for (const org of [orgA, orgB]) {
    await db.calendarEvent.deleteMany({ where: { organizationId: org } });
    await db.activityLog.deleteMany({ where: { organizationId: org } });
    await db.notification.deleteMany({ where: { organizationId: org } });
    await db.task.deleteMany({ where: { organizationId: org } });
    await db.taskCounter.deleteMany({ where: { organizationId: org } });
    await db.campaign.deleteMany({ where: { organizationId: org } });
    await db.brand.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { organizationId: org } });
    await db.organization.delete({ where: { id: org } });
  }
  await db.$disconnect();
});

describe("analytics (integration)", () => {
  it("computes organization-wide figures from a real workflow", async () => {
    const a = await loadAnalytics(sm, "30");
    if (a.scope !== "org") throw new Error("expected org scope");
    expect(a.overview).toMatchObject({ created: 3, completed: 1, open: 2, overdue: 1, reviewed: 1, revised: 1, revisionRate: 100 });
    expect(a.overview.avgDaysToPublish).not.toBeNull();
    expect(a.overview.avgApprovalHours).not.toBeNull();
    expect(a.byType.map((r) => [r.type, r.created, r.published])).toEqual([["REEL", 2, 1], ["STORY", 1, 0]]);
    expect(a.series.reduce((n, b) => n + b.created, 0)).toBe(3);
    expect(a.series.reduce((n, b) => n + b.published, 0)).toBe(1);
  });

  it("credits people correctly", async () => {
    const a = await loadAnalytics(mm, "30");
    if (a.scope !== "org") throw new Error("expected org scope");
    const p = Object.fromEntries(a.people.map((x) => [x.name, x]));
    expect(p.video).toMatchObject({ delivered: 1, open: 1, overdue: 1 });
    expect(p.editor).toMatchObject({ delivered: 2, revisionsReceived: 1, revisionRate: 50 });
    expect(p.mm.approvalsGiven).toBeGreaterThanOrEqual(3);
    expect(p.video.avgDeliveryHours).not.toBeNull();
  });

  it("reports campaign performance (lifetime)", async () => {
    const a = await loadAnalytics(sm, "365");
    if (a.scope !== "org") throw new Error("expected org scope");
    expect(a.campaigns).toHaveLength(1);
    expect(a.campaigns[0]).toMatchObject({ name: "Camp", brand: "B", total: 1, published: 1, percent: 100, revisionRate: 100 });
    expect(a.granularity).toBe("month");
  });

  it("gives production people only their own numbers, never the organization's", async () => {
    const a = await loadAnalytics(video, "30");
    expect(a.scope).toBe("self");
    if (a.scope === "self") {
      expect(a.me).toMatchObject({ userId: video.id, delivered: 1 });
      expect(Object.keys(a)).toEqual(["scope", "range", "me"]); // nothing org-wide leaks into the payload
    }
  });

  it("isolates organizations", async () => {
    const a = await loadAnalytics(outsider, "365");
    if (a.scope !== "org") throw new Error("expected org scope");
    expect(a.overview).toMatchObject({ created: 0, completed: 0, open: 0, overdue: 0 });
    expect(a.people.map((p) => p.name)).toEqual([]);
    expect(a.campaigns).toEqual([]);
  });
});
