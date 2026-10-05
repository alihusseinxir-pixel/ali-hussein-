import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { createTask, getTask, updateTask, type Actor } from "./tasks";
import { createCustomTemplate, deleteCustomTemplate, listCustomTemplates, resolveTemplateRef } from "./templates-db";
import { taskInputSchema } from "./task-schema";
import { ForbiddenError } from "./rbac";

const tag = `t${Date.now()}`;
let orgA: string, orgB: string;
let sm: Actor, mm: Actor, video: Actor, outsider: Actor;
const input = (o: Record<string, unknown>) => taskInputSchema.parse({ title: "From template", contentType: "REEL", ...o }); // the form always posts a content type (hidden when a template is used)

async function user(org: string, role: Actor["role"], n: string): Promise<Actor> {
  const u = await db.user.create({ data: { organizationId: org, name: n, email: `${n}.${tag}@x.test`, passwordHash: "x", role } });
  return { id: u.id, organizationId: org, role };
}
beforeAll(async () => {
  orgA = (await db.organization.create({ data: { name: "TA", slug: `ta-${tag}` } })).id;
  orgB = (await db.organization.create({ data: { name: "TB", slug: `tb-${tag}` } })).id;
  sm = await user(orgA, "SOCIAL_MEDIA_MANAGER", "sm");
  mm = await user(orgA, "MARKETING_MANAGER", "mm");
  video = await user(orgA, "VIDEOGRAPHER", "video");
  outsider = await user(orgB, "ADMIN", "out");
});
afterAll(async () => {
  for (const org of [orgA, orgB]) {
    await db.contentTemplate.deleteMany({ where: { organizationId: org } });
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

describe("tasks from templates", () => {
  it("locks the content type, defaults the platform and stores template-specific fields", async () => {
    const t = await createTask(sm, input({ templateRef: "product-photography", contentType: "REEL", product: "Grilled chicken", extra: { shotList: "1. Hero", lighting: " soft ", evil: "x" } }));
    expect(t.contentType).toBe("PRODUCT_PHOTOGRAPHY"); // the template wins over the posted type
    expect(t.templateRef).toBe("product-photography");
    expect(t.extra).toEqual({ shotList: "1. Hero", lighting: "soft" }); // unknown keys dropped, values trimmed
    const r = await createTask(sm, input({ templateRef: "instagram-reel", objective: "Awareness", script: "SCENE 01 – x" }));
    expect(r.platform).toBe("INSTAGRAM");
    expect(r.extra).toBeNull();
  });

  it("enforces required fields on the server, naming what is missing", async () => {
    await expect(createTask(sm, input({ templateRef: "instagram-reel", objective: "x" }))).rejects.toThrow(/Script is required for Instagram Reel/);
    await expect(createTask(sm, input({ templateRef: "product-photography" }))).rejects.toThrow(/Product, Shot list are required/);
    await expect(createTask(sm, input({ templateRef: "static-post", keyMessage: "k", extra: { onImageCopy: "   " } }))).rejects.toThrow(/Copy on the design/);
    await expect(createTask(sm, input({ templateRef: "does-not-exist" }))).rejects.toThrow(/Unknown template/);
  });

  it("free-form tasks keep working with no template", async () => {
    const t = await createTask(sm, input({ contentType: "STORY" }));
    expect(t.templateRef).toBeNull();
  });

  it("editing keeps the template rules, merges extras and never wipes values", async () => {
    const t = await createTask(sm, input({ templateRef: "product-photography", product: "P", extra: { shotList: "1.", angles: "top" } }));
    await expect(updateTask(sm, t.id, input({ contentType: "REEL", product: "P", extra: { shotList: "" } }))).rejects.toThrow(/Shot list is required/);
    await updateTask(sm, t.id, input({ contentType: "REEL", product: "P2", extra: { shotList: "1. new", lighting: "hard" } }));
    const full = await getTask(sm, t.id);
    expect(full?.contentType).toBe("PRODUCT_PHOTOGRAPHY"); // type cannot drift away from the template
    expect(full?.product).toBe("P2");
    expect(full?.extra).toEqual({ shotList: "1. new", angles: "top", lighting: "hard" }); // untouched "angles" survives
  });
});

describe("custom templates", () => {
  it("only roles with template:manage can create or delete; names are unique per org", async () => {
    await expect(createCustomTemplate(video, { name: "Nope", base: "instagram-reel" })).rejects.toThrow(ForbiddenError);
    const row = await createCustomTemplate(mm, { name: "Tazaj Reel", base: "instagram-reel", description: "House style", defaults: { hashtags: "#tazaj", cta: "Order now", models: "ignored? no, reel shows models", location: "", bogus: "x" } });
    await expect(createCustomTemplate(sm, { name: "tazaj reel", base: "tiktok" })).rejects.toThrow(/already exists/);
    await expect(createCustomTemplate(sm, { name: "Bad", base: "nope" })).rejects.toThrow(/base template/i);
    await expect(createCustomTemplate(sm, { name: "x", base: "tiktok" })).rejects.toThrow(/at least 2/);
    const def = await resolveTemplateRef(orgA, `custom:${row.id}`);
    expect(def?.defaults.hashtags).toBe("#tazaj");
    expect(def?.defaults.cta).toBe("Order now");
    expect(def?.defaults.script).toContain("SCENE 01");
    expect(Object.keys(def!.defaults)).not.toContain("bogus");
    expect(row.contentType).toBe("REEL");
  });

  it("ignores defaults for fields the base template does not show", async () => {
    const row = await createCustomTemplate(sm, { name: "Photo house", base: "product-photography", defaults: { script: "should be dropped", props: "Wooden board" } });
    const def = await resolveTemplateRef(orgA, `custom:${row.id}`);
    expect(def?.defaults.script).toBeUndefined();
    expect(def?.defaults.props).toBe("Wooden board");
  });

  it("creates tasks from a custom template, and keeps other organizations out", async () => {
    const [{ row }] = (await listCustomTemplates(orgA)).filter((c) => c.row.name === "Tazaj Reel");
    const t = await createTask(sm, input({ templateRef: `custom:${row.id}`, objective: "o", script: "SCENE 01 – a" }));
    expect(t.templateRef).toBe(`custom:${row.id}`);
    expect(t.contentType).toBe("REEL");
    expect(await resolveTemplateRef(orgB, `custom:${row.id}`)).toBeNull();
    await expect(createTask(outsider, input({ templateRef: `custom:${row.id}`, objective: "o", script: "s" }))).rejects.toThrow(/Unknown template/);
    expect(await listCustomTemplates(orgB)).toHaveLength(0);
    await expect(deleteCustomTemplate(outsider, row.id)).rejects.toThrow(/not found/i);
  });

  it("deleting a template leaves its tasks intact (they fall back to free-form)", async () => {
    const row = await createCustomTemplate(sm, { name: "Temp", base: "story" });
    const t = await createTask(sm, input({ templateRef: `custom:${row.id}`, extra: { frames: "1" } }));
    await expect(deleteCustomTemplate(video, row.id)).rejects.toThrow(ForbiddenError);
    await deleteCustomTemplate(sm, row.id);
    expect(await resolveTemplateRef(orgA, `custom:${row.id}`)).toBeNull();
    const kept = await getTask(sm, t.id);
    expect(kept?.extra).toEqual({ frames: "1" });
    await updateTask(sm, t.id, input({ contentType: "STORY", title: "Still editable" })); // no template → no required-field rules
  });
});
