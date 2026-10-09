import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { createResetLink, isResetTokenValid, requestPasswordReset, resetPassword, RESET_TTL_MS } from "./password-reset";

const tag = `pr${Date.now()}`;
let orgId: string, userId: string, disabledId: string;
const email = `ann.${tag}@x.test`;
const sent: { to: string; text: string }[] = [];
const send = async (to: string, _s: string, text: string) => { sent.push({ to, text }); };
const tokenFrom = (text: string) => /reset-password\/([\w-]+)/.exec(text)![1];
const request = (e = email, now?: Date) => requestPasswordReset(e, { send, appUrl: "http://app", now });

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: "PR", slug: `pr-${tag}` } })).id;
  userId = (await db.user.create({ data: { organizationId: orgId, name: "Ann", email, passwordHash: await bcrypt.hash("old-password-123", 4), role: "DESIGNER" } })).id;
  disabledId = (await db.user.create({ data: { organizationId: orgId, name: "Off", email: `off.${tag}@x.test`, passwordHash: "x", role: "DESIGNER", status: "DISABLED" } })).id;
});
afterAll(async () => {
  await db.activityLog.deleteMany({ where: { organizationId: orgId } });
  await db.passwordReset.deleteMany({ where: { userId: { in: [userId, disabledId] } } });
  await db.user.deleteMany({ where: { organizationId: orgId } });
  await db.organization.delete({ where: { id: orgId } });
  await db.$disconnect();
});

describe("password reset (integration)", () => {
  it("sends a link to real accounts only, without revealing which exist", async () => {
    await request("nobody@x.test");
    await request(`off.${tag}@x.test`); // disabled
    expect(sent).toHaveLength(0);
    await request(email.toUpperCase()); // case-insensitive
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(email);
    const raw = tokenFrom(sent[0].text);
    expect(await db.passwordReset.count({ where: { tokenHash: raw } })).toBe(0); // only a hash is stored
    expect(await isResetTokenValid(raw)).toBe(true);
  });

  it("only the newest link works", async () => {
    const first = tokenFrom(sent[0].text);
    await request();
    const second = tokenFrom(sent[1].text);
    expect(await isResetTokenValid(first)).toBe(false);
    expect(await isResetTokenValid(second)).toBe(true);
  });

  it("rejects weak passwords, bad and expired tokens without consuming the link", async () => {
    const t = tokenFrom(sent[1].text);
    expect(await resetPassword(t, "short")).toBe("weak");
    expect(await resetPassword("not-a-real-token-at-all", "long-enough-pass-1")).toBe("invalid");
    expect(await resetPassword(t, "long-enough-pass-1", new Date(Date.now() + RESET_TTL_MS + 1000))).toBe("invalid"); // expired
    expect(await isResetTokenValid(t)).toBe(true); // still usable inside its hour
  });

  it("changes the password once, signs out every session and is single-use", async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const t = tokenFrom(sent[1].text);
    expect(await resetPassword(t, "brand-new-password-9")).toBe("ok");
    const after = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await bcrypt.compare("brand-new-password-9", after.passwordHash)).toBe(true);
    expect(await bcrypt.compare("old-password-123", after.passwordHash)).toBe(false);
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(await resetPassword(t, "another-password-77")).toBe("invalid"); // reuse
    const [a, b] = await (async () => { await request(); return [tokenFrom(sent[2].text), tokenFrom(sent[2].text)]; })();
    const race = await Promise.all([resetPassword(a, "race-password-one-1"), resetPassword(b, "race-password-two-2")]);
    expect(race.filter((r) => r === "ok")).toHaveLength(1); // concurrent use of one link: exactly one wins
    expect(await db.activityLog.count({ where: { organizationId: orgId, action: "user.password_reset" } })).toBe(2);
  });

  it("an account disabled after requesting a link can no longer use it", async () => {
    await request();
    const t = tokenFrom(sent[sent.length - 1].text);
    expect(await isResetTokenValid(t)).toBe(true);
    await db.user.update({ where: { id: userId }, data: { status: "DISABLED" } });
    expect(await resetPassword(t, "long-enough-pass-1")).toBe("invalid");
    await db.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
  });

  it("an admin-created link works once, replaces older links, and sends no email", async () => {
    const before = sent.length;
    const first = await createResetLink(userId, "http://app");
    const second = await createResetLink(userId, "http://app");
    expect(sent.length).toBe(before);
    const t1 = first.split("/reset-password/")[1], t2 = second.split("/reset-password/")[1];
    expect(await isResetTokenValid(t1)).toBe(false);
    expect(await isResetTokenValid(t2)).toBe(true);
    expect(await resetPassword(t2, "another-long-pass-9")).toBe("ok");
    expect(await resetPassword(t2, "another-long-pass-9")).toBe("invalid");
  });
});
