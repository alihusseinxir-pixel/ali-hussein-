import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { createTask, updateTask, deleteTask, type Actor } from "./tasks";
import { listNotifications, markAllRead, markRead, unreadCount } from "./notifications";
import { runReminders } from "./reminders";
import { sendPendingEmails } from "./email-digest";
import { taskInputSchema } from "./task-schema";

const tag = `n${Date.now()}`;
let orgA: string, orgB: string;
let sm: Actor, mm: Actor, video: Actor, video2: Actor, outsider: Actor;
const NOW = new Date("2026-10-05T12:00:00Z"); // 15:00 Riyadh
const T = (h: number) => new Date(NOW.getTime() + h * 3600e3);
const local = (d: Date) => new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 16); // UTC → Riyadh wall clock for the form
const input = (o: Record<string, string>) => taskInputSchema.parse({ title: "Remind", contentType: "REEL", allowDuplicate: "1", ...o });
const notes = (a: Actor, type?: string) => db.notification.findMany({ where: { userId: a.id, ...(type && { type: type as never }) } });

async function user(org: string, role: Actor["role"], n: string): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: org, name: n, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: org, role };
}
beforeAll(async () => {
  orgA = (await db.organization.create({ data: { name: "NA", slug: `na-${tag}` } })).id;
  orgB = (await db.organization.create({ data: { name: "NB", slug: `nb-${tag}` } })).id;
  sm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm");
  mm = await user(orgA, "MARKETING_MANAGER", "mm");
  video = await user(orgA, "VIDEOGRAPHER", "video");
  video2 = await user(orgA, "VIDEOGRAPHER", "video2");
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

describe("notification inbox", () => {
  it("is private to the owner, counts unread, and marks read idempotently", async () => {
    await createTask(sm, input({ assigneeId: video.id }));
    expect(await unreadCount(video)).toBe(1);
    const [n] = (await listNotifications(video)).items;
    expect(await markRead(video2, [n.id])).toBe(0); // someone else's
    expect(await markRead(outsider, [n.id])).toBe(0);
    expect(await markRead(video, [n.id])).toBe(1);
    expect(await markRead(video, [n.id])).toBe(0);
    expect(await unreadCount(video)).toBe(0);
    expect((await listNotifications(video, { unreadOnly: true })).total).toBe(0);
    expect(await markAllRead(video2)).toBe(0);
  });
  it("hides notifications of deleted tasks", async () => {
    const t = await createTask(sm, input({ assigneeId: video2.id }));
    expect(await unreadCount(video2)).toBe(1);
    await deleteTask(mm, t.id);
    expect(await unreadCount(video2)).toBe(0);
  });
});

describe("reminders", () => {
  const run = (now = NOW) => runReminders({ now, timezone: "Asia/Riyadh" });
  let approaching: string;
  it("notifies the owner once when a deadline is within 24h, and not for far or closed tasks", async () => {
    const t = await createTask(sm, input({ title: "Soon", assigneeId: video.id, deadline: local(T(10)) }));
    approaching = t.id;
    await createTask(sm, input({ title: "Far", assigneeId: video.id, deadline: local(T(100)) }));
    const done = await createTask(sm, input({ title: "Done", assigneeId: video.id, deadline: local(T(5)) }));
    await db.task.update({ where: { id: done.id }, data: { stage: "COMPLETED" } });
    const r1 = await run();
    expect(r1.approaching).toBe(1);
    expect((await notes(video, "DEADLINE_APPROACHING")).map((n) => n.taskId)).toEqual([approaching]);
    expect((await run()).approaching).toBe(0); // idempotent
  });
  it("re-notifies when the deadline changes", async () => {
    await updateTask(sm, approaching, input({ title: "Soon", deadline: local(T(12)) }));
    expect((await run()).approaching).toBe(1);
    expect((await notes(video, "DEADLINE_APPROACHING")).length).toBe(2);
  });
  it("flags overdue tasks to the owner and the creator once, ignoring ancient ones", async () => {
    const late = await createTask(sm, input({ title: "Late", assigneeId: video2.id, deadline: local(T(-3)) }));
    await createTask(sm, input({ title: "Ancient", assigneeId: video2.id, deadline: local(T(-24 * 90)) }));
    const r = await run();
    expect(r.overdue).toBe(2); // owner + creator
    expect((await notes(video2, "TASK_OVERDUE")).map((n) => n.taskId)).toEqual([late.id]);
    expect((await notes(sm, "TASK_OVERDUE")).map((n) => n.taskId)).toEqual([late.id]);
    expect((await run()).overdue).toBe(0);
  });
  it("reminds about scheduled content before and after its publishing time, and notifies unassigned tasks' creators", async () => {
    const s = await createTask(sm, input({ title: "Scheduled", assigneeId: video.id, publishAt: local(T(1)) }));
    await db.task.update({ where: { id: s.id }, data: { stage: "SCHEDULED", currentAssigneeId: sm.id } });
    expect((await run()).publishing).toBe(1); // creator == owner → one notification
    expect((await run()).publishing).toBe(0);
    expect((await run(T(2))).publishing).toBe(1); // time has passed → a distinct "publish now" reminder
    expect((await notes(sm, "PUBLISHING_REMINDER")).length).toBe(2);
    const u = await createTask(sm, input({ title: "Unassigned", deadline: local(T(3)) }));
    await run();
    expect((await notes(sm, "DEADLINE_APPROACHING")).some((n) => n.taskId === u.id)).toBe(true);
  });
  it("skips deleted tasks", async () => {
    const t = await createTask(sm, input({ title: "Gone", assigneeId: video.id, deadline: local(T(2)) }));
    await deleteTask(mm, t.id);
    await run();
    expect((await notes(video)).some((n) => n.taskId === t.id && n.type === "DEADLINE_APPROACHING")).toBe(false);
  });
});

describe("email digest", () => {
  it("sends one email per person, only unread, respects the opt-out, and retries failures", async () => {
    await db.notification.deleteMany({ where: { organizationId: orgA } });
    await db.notification.createMany({ data: [
      { organizationId: orgA, userId: video.id, type: "TASK_ASSIGNED", message: "A" },
      { organizationId: orgA, userId: video.id, type: "HANDOVER", message: "B" },
      { organizationId: orgA, userId: video.id, type: "COMMENT", message: "read already", readAt: new Date() },
      { organizationId: orgA, userId: video2.id, type: "TASK_ASSIGNED", message: "C" },
      { organizationId: orgA, userId: mm.id, type: "TASK_ASSIGNED", message: "muted" },
    ] });
    await db.user.update({ where: { id: mm.id }, data: { emailNotifications: false } });
    const sent: { to: string; subject: string; text: string }[] = [];
    const send = async (to: string, subject: string, text: string) => { if (to.includes(tag)) sent.push({ to, subject, text }); }; // ignore unrelated rows in a shared dev DB

    expect(await sendPendingEmails({ send, enabled: false, appUrl: "http://x" })).toMatchObject({ skipped: "smtp" });
    expect(sent).toHaveLength(0);

    await sendPendingEmails({ send, enabled: true, appUrl: "http://x" });
    expect(sent).toHaveLength(2);
    expect(await db.notification.count({ where: { organizationId: orgA, emailedAt: { not: null } } })).toBe(3);
    const v = sent.find((s) => s.to.startsWith("video."))!;
    expect(v.subject).toBe("2 new notifications on BASMA MARKETING");
    expect(v.text).toContain("A"); expect(v.text).not.toContain("read already");
    expect(sent.some((s) => s.to.startsWith("mm."))).toBe(false);
    await sendPendingEmails({ send, enabled: true, appUrl: "http://x" });
    expect(sent).toHaveLength(2); // already emailed → not again

    await db.notification.create({ data: { organizationId: orgA, userId: video.id, type: "MENTION", message: "D" } });
    let calls = 0;
    const flaky = async () => { calls++; throw new Error("smtp down"); };
    await sendPendingEmails({ send: flaky, enabled: true, appUrl: "http://x" });
    expect(calls).toBeGreaterThanOrEqual(1);
    expect((await db.notification.findFirstOrThrow({ where: { userId: video.id, message: "D" } })).emailedAt).toBeNull(); // failure → left for retry
    await sendPendingEmails({ send, enabled: true, appUrl: "http://x" });
    expect(sent).toHaveLength(3); // retried and delivered
  });
});
