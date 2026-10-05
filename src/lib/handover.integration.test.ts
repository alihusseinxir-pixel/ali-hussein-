import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { createTask, getTask, type Actor } from "./tasks";
import { acceptHandover, requestChanges, submitHandover } from "./handover";
import { taskInputSchema } from "./task-schema";
import { handoverSchema } from "./handover-schema";
import { ForbiddenError } from "./rbac";

const tag = `h${Date.now()}`;
let org: string;
let sm: Actor, mm: Actor, video: Actor, editor: Actor, designer: Actor;
const ids: Record<string, string> = {};

async function user(role: Actor["role"], n: string): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: org, name: n, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  ids[n] = u.id;
  return { id: u.id, organizationId: org, role };
}
const ho = (o: Record<string, string>) => handoverSchema.parse(o);
const pending = async (a: Actor, taskId: string) => (await db.taskHandoff.findFirstOrThrow({ where: { taskId, toUserId: a.id, status: "PENDING" } })).id;
const stage = async (id: string) => (await db.task.findUniqueOrThrow({ where: { id } })).stage;

beforeAll(async () => {
  org = (await db.organization.create({ data: { name: "H", slug: `h-${tag}` } })).id;
  sm = await user("SOCIAL_MEDIA_MANAGER", "sm");
  mm = await user("MARKETING_MANAGER", "mm");
  video = await user("VIDEOGRAPHER", "video");
  editor = await user("VIDEO_EDITOR", "editor");
  designer = await user("DESIGNER", "designer");
});
afterAll(async () => {
  await db.activityLog.deleteMany({ where: { organizationId: org } });
  await db.notification.deleteMany({ where: { organizationId: org } });
  await db.task.deleteMany({ where: { organizationId: org } });
  await db.taskCounter.deleteMany({ where: { organizationId: org } });
  await db.user.deleteMany({ where: { organizationId: org } });
  await db.organization.delete({ where: { id: org } });
  await db.$disconnect();
});

describe("handover workflow (integration)", () => {
  it("runs a Reel from assignment to completion with a full audit trail", async () => {
    const t = await createTask(sm, taskInputSchema.parse({ title: "Reel flow", contentType: "REEL", assigneeId: video.id, script: "SCENE 01", publishAt: "2026-10-10T20:00" }));
    expect(t.stage).toBe("ASSIGNED");

    // the assignee confirms → production starts
    await acceptHandover(video, await pending(video, t.id));
    expect(await stage(t.id)).toBe("PRODUCTION");

    // guards
    await expect(submitHandover(editor, t.id, ho({ toUserId: mm.id }))).rejects.toThrow(ForbiddenError); // not owner
    await expect(submitHandover(video, t.id, ho({ toUserId: mm.id, instructions: "review", deadline: "2026-10-08T12:00" }))).rejects.toThrow(/delivering/); // no deliverables
    await expect(submitHandover(video, t.id, ho({ toUserId: mm.id, instructions: "review", deliverables: "raw" }))).rejects.toThrow(/deadline/i);
    await expect(submitHandover(video, t.id, ho({ toUserId: editor.id, instructions: "x", deliverables: "raw", deadline: "2026-10-08T12:00" }))).rejects.toThrow(/handled by/); // wrong role for PRODUCTION_REVIEW
    expect(await stage(t.id)).toBe("PRODUCTION");

    await submitHandover(video, t.id, ho({ toUserId: mm.id, instructions: "Please review the takes", deliverables: "Raw_01, Raw_02; best take #2", deadline: "2026-10-08T12:00" }));
    expect(await stage(t.id)).toBe("PRODUCTION_REVIEW");
    // reviewer must confirm before passing on
    await expect(submitHandover(mm, t.id, ho({ toUserId: editor.id, instructions: "edit", deadline: "2026-10-09T12:00" }))).rejects.toThrow(/Confirm the handover/);
    await acceptHandover(mm, await pending(mm, t.id));
    await submitHandover(mm, t.id, ho({ toUserId: editor.id, instructions: "Cut to 30s", requiredOutput: "30 sec vertical", deadline: "2026-10-09T12:00" }));
    expect(await stage(t.id)).toBe("EDITING");

    await acceptHandover(editor, await pending(editor, t.id));
    await submitHandover(editor, t.id, ho({ toUserId: mm.id, instructions: "review V1", deliverables: "Final_V1", deadline: "2026-10-09T18:00" }));
    await acceptHandover(mm, await pending(mm, t.id));

    // revision loop: back to the editor, history preserved
    await expect(requestChanges(video, t.id, "nope")).rejects.toThrow(ForbiddenError);
    await requestChanges(mm, t.id, "Change the first 3 seconds and replace the music.");
    expect(await stage(t.id)).toBe("EDITING");
    let full = await getTask(sm, t.id);
    expect(full?.currentAssigneeId).toBe(editor.id);
    expect(full?.revisions).toHaveLength(1);
    await acceptHandover(editor, await pending(editor, t.id));
    await submitHandover(editor, t.id, ho({ toUserId: mm.id, instructions: "review V2", deliverables: "Final_V2", deadline: "2026-10-09T20:00" }));
    await acceptHandover(mm, await pending(mm, t.id));

    // EDITING_REVIEW → INTERNAL_APPROVAL → SOCIAL_APPROVAL
    await submitHandover(mm, t.id, ho({ toUserId: mm.id, deadline: "2026-10-09T21:00" })); // self-handover needs no instructions
    expect(await stage(t.id)).toBe("INTERNAL_APPROVAL");
    await expect(submitHandover(mm, t.id, ho({ toUserId: mm.id, instructions: "x", deadline: "2026-10-09T22:00" }))).rejects.toThrow(/handled by/);
    await submitHandover(mm, t.id, ho({ toUserId: sm.id, instructions: "Final approval please", deadline: "2026-10-09T22:00" }));
    await acceptHandover(sm, await pending(sm, t.id));
    expect(await stage(t.id)).toBe("SOCIAL_APPROVAL");

    // only social media gives the final approval
    await submitHandover(sm, t.id, ho({ toUserId: sm.id }));
    expect(await stage(t.id)).toBe("SCHEDULED");
    await submitHandover(sm, t.id, ho({ toUserId: sm.id }));
    await submitHandover(sm, t.id, ho({ toUserId: sm.id }));
    expect(await stage(t.id)).toBe("COMPLETED");
    await expect(submitHandover(sm, t.id, ho({ toUserId: sm.id }))).rejects.toThrow();

    full = await getTask(sm, t.id);
    const who = new Set(full!.assignments.map((a) => a.userId));
    expect([...who]).toEqual(expect.arrayContaining([video.id, mm.id, editor.id, sm.id]));
    expect(full!.assignments.filter((a) => !a.releasedAt)).toHaveLength(1);
    expect(full!.handoffs.length).toBeGreaterThan(8);
    expect(full!.activityLogs.map((l) => l.action)).toEqual(expect.arrayContaining(["handover.created", "handover.accepted", "stage.changed", "revision.requested"]));
    expect(await db.notification.count({ where: { userId: editor.id, type: "REVISION_REQUESTED" } })).toBe(1);
  });

  it("final approval is restricted and scheduling needs a publish date", async () => {
    const t = await createTask(sm, taskInputSchema.parse({ title: "No date", contentType: "CAROUSEL", assigneeId: designer.id }));
    await acceptHandover(designer, await pending(designer, t.id));
    expect(await stage(t.id)).toBe("EDITING"); // static content skips production
    await submitHandover(designer, t.id, ho({ toUserId: mm.id, instructions: "r", deliverables: "d", deadline: "2026-10-09T12:00" }));
    await acceptHandover(mm, await pending(mm, t.id));
    await submitHandover(mm, t.id, ho({ toUserId: mm.id, deadline: "2026-10-09T13:00" }));
    await submitHandover(mm, t.id, ho({ toUserId: sm.id, instructions: "approve", deadline: "2026-10-09T14:00" }));
    await acceptHandover(sm, await pending(sm, t.id));
    await expect(submitHandover(sm, t.id, ho({ toUserId: sm.id }))).rejects.toThrow(/publishing date/);
    // the Marketing Manager (not owner, no approval:final) cannot move it either
    await expect(submitHandover(mm, t.id, ho({ toUserId: sm.id }))).rejects.toThrow(ForbiddenError);
  });

  it("two simultaneous handovers: exactly one wins", async () => {
    const t = await createTask(sm, taskInputSchema.parse({ title: "Race", contentType: "REEL", assigneeId: video.id }));
    await acceptHandover(video, await pending(video, t.id));
    const args = ho({ toUserId: mm.id, instructions: "go", deliverables: "d", deadline: "2026-10-08T12:00" });
    const res = await Promise.allSettled([submitHandover(video, t.id, args), submitHandover(video, t.id, args)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});
