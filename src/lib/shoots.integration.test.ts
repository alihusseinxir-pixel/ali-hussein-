import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { createTask, type Actor } from "./tasks";
import { taskInputSchema } from "./task-schema";
import { addChecklistItem, createShoot, deleteShoot, getShoot, listShoots, removeChecklistItem, setChecklistDone, setShootStatus, updateShoot } from "./shoots";
import { archiveLocation, createLocation, createTalent, updateTalent } from "./shoot-resources";

const tag = `sh${Date.now()}`;
let orgA: string, orgB: string;
let sm: Actor, mm: Actor, photo: Actor, photo2: Actor, video: Actor, designer: Actor, outsider: Actor;
let loc: string, loc2: string, talent: string, task: string;
const at = (day: number, h: number) => `2026-11-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:00`;
const base = (over: Record<string, unknown> = {}) => ({ title: "جلسة اختبار", startsAt: at(10, 9), endsAt: at(10, 12), ...over });

async function user(org: string, role: Actor["role"], n: string): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: org, name: n, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: org, role };
}
beforeAll(async () => {
  orgA = (await db.organization.create({ data: { name: "HA", slug: `ha-${tag}` } })).id;
  orgB = (await db.organization.create({ data: { name: "HB", slug: `hb-${tag}` } })).id;
  sm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm");
  mm = await user(orgA, "MARKETING_MANAGER", "mm");
  photo = await user(orgA, "PHOTOGRAPHER", "photo");
  photo2 = await user(orgA, "PHOTOGRAPHER", "photo2");
  video = await user(orgA, "VIDEOGRAPHER", "video");
  designer = await user(orgA, "DESIGNER", "designer");
  outsider = await user(orgB, "ADMIN", "out");
  loc = (await createLocation(sm, { name: "الاستوديو" })).id;
  loc2 = (await createLocation(sm, { name: "المكتب", mapUrl: "https://maps.example/x" })).id;
  talent = (await createTalent(sm, { name: "سارة", phone: "0500000000" })).id;
  task = (await createTask(sm, taskInputSchema.parse({ title: "Reel A", contentType: "REEL" }))).id;
});
afterAll(async () => {
  for (const org of [orgA, orgB]) {
    await db.activityLog.deleteMany({ where: { organizationId: org } });
    await db.notification.deleteMany({ where: { organizationId: org } });
    await db.shootSession.deleteMany({ where: { organizationId: org } });
    await db.talent.deleteMany({ where: { organizationId: org } });
    await db.location.deleteMany({ where: { organizationId: org } });
    await db.task.deleteMany({ where: { organizationId: org } });
    await db.taskCounter.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { organizationId: org } });
    await db.organization.delete({ where: { id: org } });
  }
  await db.$disconnect();
});

describe("shoot planning (integration)", () => {
  let shootId: string;
  it("creates a session with crew, model, content and a seeded checklist; notifies crew", async () => {
    const s = await createShoot(sm, base({ locationId: loc, photographerId: photo.id, talentIds: [talent], taskIds: [task], callTime: at(10, 8), budget: "1500.50" }));
    shootId = s.id;
    const g = (await getShoot(sm, shootId))!;
    expect(g.checklist.length).toBeGreaterThanOrEqual(15);
    expect(new Set(g.checklist.map((c) => c.phase))).toEqual(new Set(["PRE_PRODUCTION", "EQUIPMENT", "SHOOT_DAY", "HANDOVER"]));
    expect(g.talents).toHaveLength(1); expect(g.contents).toHaveLength(1); expect(Number(g.budget)).toBe(1500.5);
    expect(await db.notification.count({ where: { userId: photo.id } })).toBe(1);
  });
  it("warns about missing info", async () => {
    const g = (await getShoot(sm, shootId))!;
    const codes = g.warnings.map((w) => w.code);
    expect(codes).toContain("shotlist"); expect(codes).toContain("items"); expect(codes).not.toContain("location"); expect(codes).not.toContain("crew");
  });
  it("rejects bad input: dates, call time, crew role, unknown refs, foreign org", async () => {
    await expect(createShoot(sm, base({ endsAt: at(10, 9) }))).rejects.toThrow(/النهاية/);
    await expect(createShoot(sm, base({ callTime: at(10, 10) }))).rejects.toThrow(/الحضور/);
    await expect(createShoot(sm, base({ photographerId: video.id }))).rejects.toThrow(/المصور/); // wrong role for the slot
    await expect(createShoot(sm, base({ locationId: "nope" }))).rejects.toThrow(/اللوكيشن/);
    await expect(createShoot(sm, base({ title: "ab" }))).rejects.toThrow();
    await expect(createShoot(sm, base({ budget: "-5" }))).rejects.toThrow(/الميزانية/);
    await expect(createShoot(outsider, base({ locationId: loc }))).rejects.toThrow(); // other org's location
  });
  it("only users with shoot:manage can create or edit", async () => {
    await expect(createShoot(designer, base())).rejects.toThrow();
    await expect(updateShoot(photo, shootId, base())).rejects.toThrow();
  });
  it("flags overlapping crew, models and locations, but not back-to-back sessions", async () => {
    const clash = await createShoot(mm, base({ title: "تعارض", startsAt: at(10, 11), endsAt: at(10, 14), photographerId: photo.id, locationId: loc, talentIds: [talent] }));
    const g = (await getShoot(mm, clash.id))!;
    const msgs = g.warnings.filter((w) => w.code === "overlap" || w.code === "location").map((w) => w.message).join("\n");
    expect(msgs).toContain("photo"); expect(msgs).toContain("سارة"); expect(msgs).toContain("الاستوديو");
    // the original shows the mirror warning
    expect((await getShoot(sm, shootId))!.warnings.some((w) => w.code === "overlap")).toBe(true);
    await setShootStatus(mm, clash.id, "CANCELLED"); // a cancelled session no longer conflicts
    expect((await getShoot(sm, shootId))!.warnings.some((w) => w.code === "overlap")).toBe(false);
    const back = await createShoot(mm, base({ title: "متتالية", startsAt: at(10, 12), endsAt: at(10, 15), photographerId: photo.id, locationId: loc, talentIds: [talent] }));
    expect((await getShoot(mm, back.id))!.warnings.some((w) => w.code === "overlap" || w.code === "location")).toBe(false);
  });
  it("different crew and location in the same slot is fine", async () => {
    const s = await createShoot(sm, base({ title: "موازية", photographerId: photo2.id, locationId: loc2 }));
    expect((await getShoot(sm, s.id))!.warnings.some((w) => w.code === "overlap" || w.code === "location")).toBe(false);
  });
  it("crew only see their own sessions; others in the org see none; other orgs see nothing", async () => {
    expect(await getShoot(photo, shootId)).not.toBeNull();
    expect(await getShoot(photo2, shootId)).toBeNull();
    expect(await getShoot(designer, shootId)).toBeNull();
    expect(await getShoot(outsider, shootId)).toBeNull();
    const range = { from: new Date("2026-11-01"), to: new Date("2026-12-01") };
    expect((await listShoots(photo, range)).every((s) => s.photographerId === photo.id)).toBe(true);
    expect((await listShoots(sm, range)).length).toBeGreaterThanOrEqual(4);
  });
  it("checklist: crew can tick, only managers add/remove, strangers cannot", async () => {
    const item = (await getShoot(sm, shootId))!.checklist[0];
    await setChecklistDone(photo, item.id, true);
    const after = (await getShoot(sm, shootId))!.checklist.find((c) => c.id === item.id)!;
    expect([after.done, after.doneById]).toEqual([true, photo.id]);
    await expect(setChecklistDone(photo2, item.id, true)).rejects.toThrow();
    await expect(setChecklistDone(designer, item.id, true)).rejects.toThrow();
    await expect(addChecklistItem(photo, shootId, "SHOOT_DAY", "x")).rejects.toThrow();
    await addChecklistItem(sm, shootId, "SHOOT_DAY", "  عنصر جديد  ");
    const added = (await getShoot(sm, shootId))!.checklist.find((c) => c.label === "عنصر جديد")!;
    await expect(addChecklistItem(sm, shootId, "SHOOT_DAY", "  ")).rejects.toThrow();
    await removeChecklistItem(sm, added.id);
    expect((await getShoot(sm, shootId))!.checklist.some((c) => c.id === added.id)).toBe(false);
  });
  it("edit replaces models/content; completed or cancelled sessions are locked", async () => {
    await updateShoot(sm, shootId, base({ locationId: loc, photographerId: photo.id, talentIds: [], taskIds: [], shotList: "1" }));
    const g = (await getShoot(sm, shootId))!;
    expect([g.talents.length, g.contents.length]).toEqual([0, 0]);
    await setShootStatus(sm, shootId, "COMPLETED");
    await expect(updateShoot(sm, shootId, base())).rejects.toThrow(/مكتملة/);
    await expect(setShootStatus(sm, shootId, "CANCELLED")).rejects.toThrow();
  });
  it("locations/models: validated, archived not deleted, org-scoped", async () => {
    await expect(createLocation(sm, { name: "مكتب", mapUrl: "javascript:alert(1)" })).rejects.toThrow(/http/);
    await expect(createTalent(sm, { name: "سارة", email: "bad" })).rejects.toThrow(/البريد/);
    await expect(createTalent(designer, { name: "نورة" })).rejects.toThrow();
    await expect(updateTalent(outsider, talent, { name: "hack" })).rejects.toThrow();
    await archiveLocation(sm, loc2);
    await expect(createShoot(sm, base({ locationId: loc2 }))).rejects.toThrow(/اللوكيشن/);
    expect(await db.location.count({ where: { id: loc2 } })).toBe(1);
  });
  it("soft-deletes a session", async () => {
    const s = await createShoot(sm, base({ title: "للحذف" }));
    await deleteShoot(sm, s.id);
    expect(await getShoot(sm, s.id)).toBeNull();
    expect(await db.shootSession.count({ where: { id: s.id } })).toBe(1);
  });
});
