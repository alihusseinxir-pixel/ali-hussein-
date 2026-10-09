import type { Prisma, TaskStage } from "@prisma/client";

/**
 * The five working statuses users think in, derived from the workflow stage (single source of truth: `Task.stage`).
 * IN_PROGRESS vs CHANGES_REQUESTED depends on whether the task has an unresolved revision request.
 */
export const WORK_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "CHANGES_REQUESTED", "DONE"] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  TODO: "للإنجاز", IN_PROGRESS: "قيد التنفيذ", IN_REVIEW: "قيد المراجعة", CHANGES_REQUESTED: "مطلوب تعديلات", DONE: "مكتمل",
};

const TODO: TaskStage[] = ["IDEA", "BRIEF", "ASSIGNED"];
const WORKING: TaskStage[] = ["PRODUCTION", "EDITING"];
const REVIEW: TaskStage[] = ["PRODUCTION_REVIEW", "EDITING_REVIEW", "INTERNAL_APPROVAL", "SOCIAL_APPROVAL"];
const DONE: TaskStage[] = ["SCHEDULED", "PUBLISHED", "COMPLETED"];

export function workStatus(stage: TaskStage, hasOpenRevision: boolean): WorkStatus {
  if (TODO.includes(stage)) return "TODO";
  if (REVIEW.includes(stage)) return "IN_REVIEW";
  if (DONE.includes(stage)) return "DONE";
  return hasOpenRevision ? "CHANGES_REQUESTED" : "IN_PROGRESS";
}

const OPEN_REVISION: Prisma.TaskWhereInput = { revisions: { some: { resolvedAt: null } } };
export function workStatusWhere(s: WorkStatus): Prisma.TaskWhereInput {
  switch (s) {
    case "TODO": return { stage: { in: TODO } };
    case "IN_REVIEW": return { stage: { in: REVIEW } };
    case "DONE": return { stage: { in: DONE } };
    case "CHANGES_REQUESTED": return { AND: [{ stage: { in: WORKING } }, OPEN_REVISION] };
    case "IN_PROGRESS": return { AND: [{ stage: { in: WORKING } }, { NOT: OPEN_REVISION }] };
  }
}

export const DUE_FILTERS = ["overdue", "today", "week", "none"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];
