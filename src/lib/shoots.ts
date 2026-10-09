import "server-only";
import { Prisma, type ChecklistPhase, type ShootStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { env } from "./env";
import { logActivity } from "./activity";
import { ForbiddenError, assertCan, can } from "./rbac";
import { parseLocalDateTime } from "./datetime";
import { TaskError, visibleTasksWhere, type Actor } from "./tasks";
import { DEFAULT_CHECKLIST, PHASES, missingInfo, type Warning } from "./shoot-checks";

const text = (max: number) => z.string().trim().max(max, `الحد الأقصى ${max} حرف`).optional().transform((v) => (v ? v : null));
export const shootSchema = z.object({
  title: z.string().trim().min(3, "عنوان الجلسة 3 أحرف على الأقل").max(200),
  startsAt: z.string().min(1, "وقت البداية مطلوب"),
  endsAt: z.string().min(1, "وقت النهاية مطلوب"),
  callTime: text(40),
  locationId: text(40), photographerId: text(40), videographerId: text(40), directorId: text(40),
  requiredItems: text(5000), shotList: text(10000), prepNotes: text(5000),
  budget: z.string().trim().optional().transform((v, ctx) => {
    if (!v) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) { ctx.addIssue({ code: "custom", message: "الميزانية غير صالحة" }); return z.NEVER; }
    return n;
  }),
  talentIds: z.array(z.string()).max(50).default([]),
  taskIds: z.array(z.string()).max(50).default([]),
});
export type ShootInput = z.input<typeof shootSchema>;

const isManager = (a: Actor) => can(a.role, "shoot:manage");
/** Managers (and anyone who sees the whole calendar) see every session; crew only see the ones they are on. */
export function visibleShootsWhere(a: Actor): Prisma.ShootSessionWhereInput {
  const base: Prisma.ShootSessionWhereInput = { organizationId: a.organizationId, deletedAt: null };
  if (isManager(a) || can(a.role, "calendar:view:all")) return base;
  return { ...base, OR: [{ photographerId: a.id }, { videographerId: a.id }, { directorId: a.id }] };
}

function parseTimes(i: z.output<typeof shootSchema>) {
  const tz = env.timezone;
  const p = (v: string | null, label: string) => {
    if (!v) return null;
    const d = parseLocalDateTime(v, tz);
    if (!d) throw new TaskError(`${label} غير صالح.`);
    return d;
  };
  const startsAt = p(i.startsAt, "وقت البداية")!, endsAt = p(i.endsAt, "وقت النهاية")!, callTime = p(i.callTime, "وقت الحضور");
  if (endsAt <= startsAt) throw new TaskError("وقت النهاية يجب أن يكون بعد وقت البداية.");
  if (callTime && callTime > startsAt) throw new TaskError("وقت الحضور يجب ألا يتجاوز وقت البداية.");
  return { startsAt, endsAt, callTime };
}

async function validateRefs(a: Actor, i: z.output<typeof shootSchema>) {
  const org = a.organizationId;
  if (i.locationId && !(await db.location.findFirst({ where: { id: i.locationId, organizationId: org, deletedAt: null } }))) throw new TaskError("اللوكيشن غير موجود.");
  const crew = async (id: string | null, roles: string[] | null, label: string) => {
    if (!id) return;
    const u = await db.user.findFirst({ where: { id, organizationId: org, status: "ACTIVE", deletedAt: null } });
    if (!u || (roles && !roles.includes(u.role))) throw new TaskError(`${label} غير صالح.`);
  };
  await crew(i.photographerId, ["PHOTOGRAPHER"], "المصور الفوتوغرافي");
  await crew(i.videographerId, ["VIDEOGRAPHER"], "مصور الفيديو");
  await crew(i.directorId, null, "المخرج/المنتج");
  const talentIds = [...new Set(i.talentIds)], taskIds = [...new Set(i.taskIds)];
  if (talentIds.length && (await db.talent.count({ where: { id: { in: talentIds }, organizationId: org, deletedAt: null } })) !== talentIds.length) throw new TaskError("أحد المودلز غير موجود.");
  if (taskIds.length && (await db.task.count({ where: { AND: [visibleTasksWhere(a), { id: { in: taskIds } }] } })) !== taskIds.length) throw new TaskError("أحد عناصر المحتوى غير موجود.");
  return { talentIds, taskIds };
}

function parse(input: ShootInput) {
  const r = shootSchema.safeParse(input);
  if (!r.success) throw new TaskError(r.error.issues[0].message);
  return r.data;
}

export async function createShoot(a: Actor, input: ShootInput) {
  assertCan(a.role, "shoot:manage");
  const i = parse(input);
  const times = parseTimes(i);
  const { talentIds, taskIds } = await validateRefs(a, i);
  return db.$transaction(async (tx) => {
    const s = await tx.shootSession.create({
      data: {
        organizationId: a.organizationId, title: i.title, ...times, locationId: i.locationId, photographerId: i.photographerId,
        videographerId: i.videographerId, directorId: i.directorId, requiredItems: i.requiredItems, shotList: i.shotList,
        prepNotes: i.prepNotes, budget: i.budget, createdById: a.id,
        talents: { create: talentIds.map((talentId) => ({ talentId })) },
        contents: { create: taskIds.map((taskId) => ({ taskId })) },
        checklist: { create: PHASES.flatMap((phase) => DEFAULT_CHECKLIST[phase].map((label, position) => ({ phase, label, position }))) },
      },
    });
    await logActivity(tx, { organizationId: a.organizationId, actorId: a.id, action: "shoot.created", meta: { shootId: s.id, title: s.title } });
    for (const uid of new Set([i.photographerId, i.videographerId, i.directorId].filter((x): x is string => !!x && x !== a.id))) {
      await tx.notification.create({ data: { organizationId: a.organizationId, userId: uid, type: "TASK_ASSIGNED", message: `تمت إضافتك إلى جلسة تصوير: ${s.title}` } });
    }
    return s;
  });
}

export async function updateShoot(a: Actor, id: string, input: ShootInput) {
  assertCan(a.role, "shoot:manage");
  const existing = await db.shootSession.findFirst({ where: { id, organizationId: a.organizationId, deletedAt: null } });
  if (!existing) throw new TaskError("جلسة التصوير غير موجودة.");
  if (existing.status !== "PLANNED") throw new TaskError("لا يمكن تعديل جلسة مكتملة أو ملغاة.");
  const i = parse(input);
  const times = parseTimes(i);
  const { talentIds, taskIds } = await validateRefs(a, i);
  return db.$transaction(async (tx) => {
    await tx.shootTalent.deleteMany({ where: { shootId: id } });
    await tx.shootContent.deleteMany({ where: { shootId: id } });
    const s = await tx.shootSession.update({
      where: { id },
      data: {
        title: i.title, ...times, locationId: i.locationId, photographerId: i.photographerId, videographerId: i.videographerId, directorId: i.directorId,
        requiredItems: i.requiredItems, shotList: i.shotList, prepNotes: i.prepNotes, budget: i.budget,
        talents: { create: talentIds.map((talentId) => ({ talentId })) },
        contents: { create: taskIds.map((taskId) => ({ taskId })) },
      },
    });
    await logActivity(tx, { organizationId: a.organizationId, actorId: a.id, action: "shoot.updated", meta: { shootId: id } });
    const added = [i.photographerId, i.videographerId, i.directorId].filter((x): x is string => !!x && x !== a.id && ![existing.photographerId, existing.videographerId, existing.directorId].includes(x));
    for (const uid of new Set(added)) {
      await tx.notification.create({ data: { organizationId: a.organizationId, userId: uid, type: "TASK_ASSIGNED", message: `تمت إضافتك إلى جلسة تصوير: ${s.title}` } });
    }
    return s;
  });
}

export async function setShootStatus(a: Actor, id: string, status: ShootStatus) {
  assertCan(a.role, "shoot:manage");
  const r = await db.shootSession.updateMany({ where: { id, organizationId: a.organizationId, deletedAt: null, status: "PLANNED" }, data: { status } });
  if (r.count !== 1) throw new TaskError("لا يمكن تغيير حالة هذه الجلسة.");
  await logActivity(db, { organizationId: a.organizationId, actorId: a.id, action: `shoot.${status.toLowerCase()}`, meta: { shootId: id } });
}

export async function deleteShoot(a: Actor, id: string) {
  assertCan(a.role, "shoot:manage");
  const r = await db.shootSession.updateMany({ where: { id, organizationId: a.organizationId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (r.count !== 1) throw new TaskError("جلسة التصوير غير موجودة.");
  await logActivity(db, { organizationId: a.organizationId, actorId: a.id, action: "shoot.deleted", meta: { shootId: id } });
}

const FULL = {
  location: true,
  photographer: { select: { id: true, name: true } }, videographer: { select: { id: true, name: true } }, director: { select: { id: true, name: true } },
  talents: { include: { talent: true } },
  contents: { include: { task: { select: { id: true, taskCode: true, title: true, contentType: true } } } },
} satisfies Prisma.ShootSessionInclude;

/** Other live sessions that overlap this one and share a crew member, a model or the location. */
export async function findConflicts(s: {
  id: string; organizationId: string; startsAt: Date; endsAt: Date; locationId: string | null;
  photographerId: string | null; videographerId: string | null; directorId: string | null; talentIds: string[];
}): Promise<Warning[]> {
  const crewIds = [s.photographerId, s.videographerId, s.directorId].filter((x): x is string => !!x);
  const or: Prisma.ShootSessionWhereInput[] = [];
  if (crewIds.length) or.push({ photographerId: { in: crewIds } }, { videographerId: { in: crewIds } }, { directorId: { in: crewIds } });
  if (s.talentIds.length) or.push({ talents: { some: { talentId: { in: s.talentIds } } } });
  if (s.locationId) or.push({ locationId: s.locationId });
  if (!or.length) return [];
  const others = await db.shootSession.findMany({
    where: { organizationId: s.organizationId, deletedAt: null, status: { not: "CANCELLED" }, id: { not: s.id }, startsAt: { lt: s.endsAt }, endsAt: { gt: s.startsAt }, OR: or },
    include: { photographer: { select: { id: true, name: true } }, videographer: { select: { id: true, name: true } }, director: { select: { id: true, name: true } }, talents: { include: { talent: true } }, location: true },
    orderBy: { startsAt: "asc" },
  });
  const out: Warning[] = [];
  for (const o of others) {
    const who = new Map<string, string>();
    for (const u of [o.photographer, o.videographer, o.director]) if (u && crewIds.includes(u.id)) who.set(`u${u.id}`, u.name);
    for (const t of o.talents) if (s.talentIds.includes(t.talentId)) who.set(`t${t.talentId}`, t.talent.name);
    const names = [...who.values()];
    if (names.length) out.push({ code: "overlap", message: `تعارض مواعيد: ${names.join("، ")} مرتبط بجلسة "${o.title}" في نفس الوقت.` });
    if (s.locationId && o.locationId === s.locationId) out.push({ code: "location", message: `اللوكيشن "${o.location?.name}" محجوز لجلسة "${o.title}" في نفس الوقت.` });
  }
  return out;
}

export async function getShoot(a: Actor, id: string) {
  const s = await db.shootSession.findFirst({
    where: { AND: [visibleShootsWhere(a), { id }] },
    include: { ...FULL, checklist: { orderBy: [{ phase: "asc" }, { position: "asc" }] } },
  });
  if (!s) return null;
  const warnings = s.status === "CANCELLED" ? [] : [
    ...missingInfo({ ...s, talentCount: s.talents.length, contentCount: s.contents.length }),
    ...(await findConflicts({ ...s, talentIds: s.talents.map((t) => t.talentId) })),
  ];
  return { ...s, warnings, canManage: isManager(a), canCheck: isManager(a) || [s.photographerId, s.videographerId, s.directorId].includes(a.id) };
}

export async function listShoots(a: Actor, range: { from: Date; to: Date }) {
  const rows = await db.shootSession.findMany({
    where: { AND: [visibleShootsWhere(a), { startsAt: { gte: range.from, lt: range.to } }] },
    include: { ...FULL, checklist: { select: { done: true } } },
    orderBy: { startsAt: "asc" },
  });
  return Promise.all(rows.map(async (s) => ({
    ...s,
    warnings: s.status === "CANCELLED" ? [] : [
      ...missingInfo({ ...s, talentCount: s.talents.length, contentCount: s.contents.length }),
      ...(await findConflicts({ ...s, talentIds: s.talents.map((t) => t.talentId) })),
    ],
  })));
}

// ───────── checklists ─────────
async function checklistShoot(a: Actor, shootId: string) {
  const s = await db.shootSession.findFirst({ where: { AND: [visibleShootsWhere(a), { id: shootId }] } });
  if (!s) throw new TaskError("جلسة التصوير غير موجودة.");
  if (!isManager(a) && ![s.photographerId, s.videographerId, s.directorId].includes(a.id)) throw new ForbiddenError("ليست لديك صلاحية تعديل القوائم.");
  return s;
}

export async function setChecklistDone(a: Actor, itemId: string, done: boolean) {
  const item = await db.shootChecklistItem.findUnique({ where: { id: itemId } });
  if (!item) throw new TaskError("العنصر غير موجود.");
  await checklistShoot(a, item.shootId);
  await db.shootChecklistItem.update({ where: { id: itemId }, data: { done, doneById: done ? a.id : null, doneAt: done ? new Date() : null } });
  return item.shootId;
}

export async function addChecklistItem(a: Actor, shootId: string, phase: ChecklistPhase, label: string) {
  assertCan(a.role, "shoot:manage");
  await checklistShoot(a, shootId);
  const clean = label.trim();
  if (!clean || clean.length > 300) throw new TaskError("نص العنصر مطلوب (300 حرف كحد أقصى).");
  const last = await db.shootChecklistItem.findFirst({ where: { shootId, phase }, orderBy: { position: "desc" } });
  await db.shootChecklistItem.create({ data: { shootId, phase, label: clean, position: (last?.position ?? -1) + 1 } });
}

export async function removeChecklistItem(a: Actor, itemId: string) {
  assertCan(a.role, "shoot:manage");
  const item = await db.shootChecklistItem.findUnique({ where: { id: itemId } });
  if (!item) throw new TaskError("العنصر غير موجود.");
  await checklistShoot(a, item.shootId);
  await db.shootChecklistItem.delete({ where: { id: itemId } });
  return item.shootId;
}
