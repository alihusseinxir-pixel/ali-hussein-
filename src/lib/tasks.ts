import "server-only";
import type { Prisma, Role, TaskStage, Priority } from "@prisma/client";
import { db } from "./db";
import { env } from "./env";
import { parseLocalDateTime } from "./datetime";
import { logActivity } from "./activity";
import { ForbiddenError, assertCan, can } from "./rbac";
import { firstAssigneeRoles, initialStage, isReassignable } from "./workflow";
import type { TaskInput } from "./task-schema";

export class TaskError extends Error {}

export interface Actor {
  id: string;
  organizationId: string;
  role: Role;
}

/** Tenancy + visibility filter. EVERY task query must go through this. */
export function visibleTasksWhere(actor: Actor): Prisma.TaskWhereInput {
  const base: Prisma.TaskWhereInput = { organizationId: actor.organizationId, deletedAt: null };
  if (can(actor.role, "task:view:all")) return base;
  return {
    ...base,
    OR: [
      { currentAssigneeId: actor.id },
      { createdById: actor.id },
      { assignments: { some: { userId: actor.id } } }, // previous owners keep read access
    ],
  };
}

export interface TaskFilters {
  q?: string;
  stage?: TaskStage;
  priority?: Priority;
  assigneeId?: string;
  campaignId?: string;
  mine?: boolean;
  overdue?: boolean;
  sort?: "deadline" | "created" | "priority";
  page?: number;
}
export const PAGE_SIZE = 20;
const CLOSED: TaskStage[] = ["PUBLISHED", "COMPLETED"];

export async function listTasks(actor: Actor, f: TaskFilters = {}) {
  const and: Prisma.TaskWhereInput[] = [visibleTasksWhere(actor)];
  if (f.q) {
    and.push({ OR: [
      { title: { contains: f.q, mode: "insensitive" } },
      { taskCode: { contains: f.q, mode: "insensitive" } },
    ] });
  }
  if (f.stage) and.push({ stage: f.stage });
  if (f.priority) and.push({ priority: f.priority });
  if (f.assigneeId) and.push({ currentAssigneeId: f.assigneeId });
  if (f.campaignId) and.push({ campaignId: f.campaignId });
  if (f.mine) and.push({ currentAssigneeId: actor.id });
  if (f.overdue) and.push({ deadline: { lt: new Date() }, stage: { notIn: CLOSED } });
  const where: Prisma.TaskWhereInput = { AND: and };
  const orderBy: Prisma.TaskOrderByWithRelationInput[] =
    f.sort === "created" ? [{ createdAt: "desc" }]
    : f.sort === "priority" ? [{ priority: "desc" }, { deadline: "asc" }]
    : [{ deadline: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }];
  const page = Math.max(1, f.page ?? 1);
  const [items, total] = await Promise.all([
    db.task.findMany({
      where, orderBy, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
      include: {
        currentAssignee: { select: { id: true, name: true, role: true } },
        campaign: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
      },
    }),
    db.task.count({ where }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getTask(actor: Actor, id: string) {
  return db.task.findFirst({
    where: { AND: [visibleTasksWhere(actor), { id }] },
    include: {
      createdBy: { select: { id: true, name: true, role: true } },
      currentAssignee: { select: { id: true, name: true, role: true } },
      brand: true,
      campaign: true,
      assignments: { include: { user: { select: { id: true, name: true, role: true } } }, orderBy: { assignedAt: "asc" } },
      activityLogs: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
}

export async function dashboardCounts(actor: Actor) {
  const where = visibleTasksWhere(actor);
  const grouped = await db.task.groupBy({ by: ["stage"], where, _count: true });
  const overdue = await db.task.count({ where: { AND: [where, { deadline: { lt: new Date() }, stage: { notIn: CLOSED } }] } });
  const by = Object.fromEntries(grouped.map((g) => [g.stage, g._count])) as Partial<Record<TaskStage, number>>;
  const sum = (...s: TaskStage[]) => s.reduce((a, k) => a + (by[k] ?? 0), 0);
  return {
    total: grouped.reduce((a, g) => a + g._count, 0),
    inProduction: sum("ASSIGNED", "PRODUCTION"),
    editing: sum("EDITING"),
    waitingReview: sum("PRODUCTION_REVIEW", "EDITING_REVIEW", "INTERNAL_APPROVAL"),
    waitingApproval: sum("SOCIAL_APPROVAL"),
    scheduled: sum("SCHEDULED"),
    published: sum("PUBLISHED"),
    completed: sum("COMPLETED"),
    overdue,
  };
}

// ───────── helpers ─────────

async function resolveRefs(actor: Actor, input: TaskInput) {
  // Brand/campaign/assignee must belong to the actor's organization.
  if (input.brandId) {
    const ok = await db.brand.findFirst({ where: { id: input.brandId, organizationId: actor.organizationId, deletedAt: null } });
    if (!ok) throw new TaskError("Unknown brand.");
  }
  if (input.campaignId) {
    const c = await db.campaign.findFirst({ where: { id: input.campaignId, organizationId: actor.organizationId, deletedAt: null } });
    if (!c) throw new TaskError("Unknown campaign.");
    if (input.brandId && c.brandId !== input.brandId) throw new TaskError("Campaign does not belong to that brand.");
    input.brandId = c.brandId;
  }
  if (input.assigneeId) {
    const u = await db.user.findFirst({
      where: { id: input.assigneeId, organizationId: actor.organizationId, status: "ACTIVE", deletedAt: null },
    });
    if (!u) throw new TaskError("Unknown assignee.");
    const allowed = firstAssigneeRoles(input.contentType);
    if (!allowed.includes(u.role)) {
      throw new TaskError(`A ${input.contentType.replace(/_/g, " ").toLowerCase()} task must be assigned to a ${allowed.join(" / ").replace(/_/g, " ").toLowerCase()}.`);
    }
  }
}

function dataFrom(input: TaskInput) {
  const tz = env.timezone;
  const d = (v: string | null) => {
    if (!v) return null;
    const out = parseLocalDateTime(v, tz);
    if (!out) throw new TaskError("Invalid date/time.");
    return out;
  };
  const {
    title, contentType, platform, priority, brandId, campaignId, objective, targetAudience, consumerInsight, keyMessage,
    cta, caption, hashtags, brief, script, references, models, location, props, product, specialNotes,
  } = input;
  const data = {
    title, contentType, platform: platform ?? null, priority, brandId, campaignId, objective, targetAudience,
    consumerInsight, keyMessage, cta, caption, hashtags, brief, script, references, models, location, props, product,
    specialNotes,
    shootingAt: d(input.shootingAt), publishAt: d(input.publishAt), startDate: d(input.startDate), deadline: d(input.deadline),
  };
  if (data.startDate && data.deadline && data.deadline < data.startDate) throw new TaskError("Deadline must be after the start date.");
  return data;
}

async function nextTaskCode(tx: Prisma.TransactionClient, organizationId: string) {
  const year = new Date().getFullYear();
  // Atomic per-org/year counter: concurrent creates can never collide.
  const row = await tx.taskCounter.upsert({
    where: { organizationId_year: { organizationId, year } },
    create: { organizationId, year, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });
  return `BASMA-${year}-${String(row.lastValue).padStart(5, "0")}`;
}

// ───────── commands ─────────

export async function createTask(actor: Actor, input: TaskInput) {
  assertCan(actor.role, "task:create");
  await resolveRefs(actor, input);
  const data = dataFrom(input);
  return db.$transaction(async (tx) => {
    const taskCode = await nextTaskCode(tx, actor.organizationId);
    const stage = initialStage(!!input.assigneeId);
    const task = await tx.task.create({
      data: {
        ...data, organizationId: actor.organizationId, taskCode, stage,
        createdById: actor.id, currentAssigneeId: input.assigneeId,
      },
    });
    await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId: task.id, action: "task.created", meta: { taskCode, title: task.title } });
    if (input.assigneeId) {
      await tx.taskAssignment.create({ data: { taskId: task.id, userId: input.assigneeId, stage } });
      await tx.notification.create({
        data: {
          organizationId: actor.organizationId, userId: input.assigneeId, taskId: task.id,
          type: "TASK_ASSIGNED", message: `You have been assigned ${taskCode}: ${task.title}`,
        },
      });
      await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId: task.id, action: "task.assigned", meta: { toUserId: input.assigneeId } });
    }
    return task;
  });
}

function canEdit(actor: Actor, createdById: string) {
  return can(actor.role, "task:edit:any") || (can(actor.role, "task:edit:own") && createdById === actor.id);
}

const TRACKED = ["title", "priority", "deadline", "shootingAt", "publishAt", "startDate", "contentType", "platform", "campaignId", "brandId"] as const;

export async function updateTask(actor: Actor, id: string, input: TaskInput) {
  const existing = await db.task.findFirst({ where: { id, organizationId: actor.organizationId, deletedAt: null } });
  if (!existing) throw new TaskError("Task not found.");
  if (!canEdit(actor, existing.createdById)) throw new ForbiddenError();
  if (["PUBLISHED", "COMPLETED"].includes(existing.stage)) throw new TaskError("Published or completed tasks are read-only.");
  // The assignee is changed through assignTask so history stays consistent.
  input.assigneeId = existing.currentAssigneeId;
  await resolveRefs(actor, input);
  const data = dataFrom(input);
  const changed = TRACKED.filter((k) => {
    const a = existing[k] instanceof Date ? (existing[k] as Date).getTime() : existing[k];
    const b = data[k] instanceof Date ? (data[k] as Date).getTime() : data[k];
    return a !== b;
  });
  return db.$transaction(async (tx) => {
    const task = await tx.task.update({ where: { id }, data });
    if (changed.includes("deadline")) {
      await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId: id, action: "task.deadline_changed",
        meta: { from: existing.deadline?.toISOString() ?? null, to: data.deadline?.toISOString() ?? null } });
    }
    await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId: id, action: "task.updated", meta: { changed } });
    return task;
  });
}

export async function assignTask(actor: Actor, id: string, assigneeId: string) {
  assertCan(actor.role, "task:assign");
  const task = await db.task.findFirst({ where: { id, organizationId: actor.organizationId, deletedAt: null } });
  if (!task) throw new TaskError("Task not found.");
  if (!isReassignable(task.stage)) throw new TaskError("Tasks in review or approval move through handovers, not reassignment.");
  if (task.currentAssigneeId === assigneeId) return task;
  const user = await db.user.findFirst({ where: { id: assigneeId, organizationId: actor.organizationId, status: "ACTIVE", deletedAt: null } });
  if (!user) throw new TaskError("Unknown assignee.");
  const inEditing = task.stage === "EDITING";
  const allowed = inEditing ? ["VIDEO_EDITOR", "DESIGNER"] : firstAssigneeRoles(task.contentType);
  if (!allowed.includes(user.role)) throw new TaskError(`This task must be assigned to: ${allowed.join(" / ").replace(/_/g, " ").toLowerCase()}.`);
  const stage: TaskStage = task.stage === "IDEA" || task.stage === "BRIEF" ? "ASSIGNED" : task.stage;
  return db.$transaction(async (tx) => {
    await tx.taskAssignment.updateMany({ where: { taskId: id, releasedAt: null }, data: { releasedAt: new Date() } });
    await tx.taskAssignment.create({ data: { taskId: id, userId: assigneeId, stage } });
    const updated = await tx.task.update({ where: { id }, data: { currentAssigneeId: assigneeId, stage } });
    await tx.notification.create({
      data: { organizationId: actor.organizationId, userId: assigneeId, taskId: id, type: "TASK_ASSIGNED",
        message: `You have been assigned ${task.taskCode}: ${task.title}` },
    });
    await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, taskId: id, action: "task.assigned",
      meta: { fromUserId: task.currentAssigneeId, toUserId: assigneeId } });
    return updated;
  });
}

export async function deleteTask(actor: Actor, id: string) {
  assertCan(actor.role, "task:delete");
  const res = await db.task.updateMany({ where: { id, organizationId: actor.organizationId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (res.count === 0) throw new TaskError("Task not found.");
  await logActivity(db, { organizationId: actor.organizationId, actorId: actor.id, taskId: id, action: "task.deleted" });
}
