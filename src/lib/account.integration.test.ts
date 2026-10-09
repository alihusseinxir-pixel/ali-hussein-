import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { changePassword } from "./account";

const tag = `ac${Date.now()}`;
let orgId: string, userId: string;

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: "AC", slug: `ac-${tag}` } })).id;
  userId = (await db.user.create({ data: { organizationId: orgId, name: "Ann", email: `ann.${tag}@x.test`, passwordHash: await bcrypt.hash("old-password-123", 4), role: "DESIGNER" } })).id;
});
afterAll(async () => {
  await db.activityLog.deleteMany({ where: { organizationId: orgId } });
  await db.user.deleteMany({ where: { organizationId: orgId } });
  await db.organization.delete({ where: { id: orgId } });
  await db.$disconnect();
});

describe("changePassword (integration)", () => {
  it("rejects a wrong current password, a weak or identical new one", async () => {
    expect(await changePassword(userId, "nope-nope-nope", "brand-new-pass-1")).toEqual({ ok: false, reason: "wrong_password" });
    expect(await changePassword(userId, "old-password-123", "short")).toEqual({ ok: false, reason: "weak" });
    expect(await changePassword(userId, "old-password-123", "old-password-123")).toEqual({ ok: false, reason: "same" });
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion).toBe(0);
  });

  it("changes the password and revokes other sessions", async () => {
    const r = await changePassword(userId, "old-password-123", "brand-new-pass-1");
    expect(r).toEqual({ ok: true, sessionVersion: 1 });
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await bcrypt.compare("brand-new-pass-1", u.passwordHash)).toBe(true);
    expect(await db.activityLog.count({ where: { organizationId: orgId, action: "user.password_changed" } })).toBe(1);
  });

  it("refuses a disabled or unknown user", async () => {
    await db.user.update({ where: { id: userId }, data: { status: "DISABLED" } });
    expect(await changePassword(userId, "brand-new-pass-1", "another-pass-12")).toEqual({ ok: false, reason: "unavailable" });
  });
});
