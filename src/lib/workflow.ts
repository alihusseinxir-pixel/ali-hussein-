import type { ContentType, Role, TaskStage } from "@prisma/client";

/**
 * Workflow state machine (pure — no I/O, fully unit-tested).
 * Phase 2 uses it for initial stage + assignee validation; Phase 3 builds the
 * handover engine on top of `canTransition`.
 */

export const STAGE_LABELS: Record<TaskStage, string> = {
  IDEA: "Idea",
  BRIEF: "Brief created",
  ASSIGNED: "Assigned",
  PRODUCTION: "Production",
  PRODUCTION_REVIEW: "Production review",
  EDITING: "Editing / Design",
  EDITING_REVIEW: "Editing review",
  INTERNAL_APPROVAL: "Internal approval",
  SOCIAL_APPROVAL: "Social media approval",
  SCHEDULED: "Scheduled",
  PUBLISHED: "Published",
  COMPLETED: "Completed",
};

const TAIL: TaskStage[] = ["INTERNAL_APPROVAL", "SOCIAL_APPROVAL", "SCHEDULED", "PUBLISHED", "COMPLETED"];

const SHOOT_PATH: TaskStage[] = [
  "IDEA", "BRIEF", "ASSIGNED", "PRODUCTION", "PRODUCTION_REVIEW", "EDITING", "EDITING_REVIEW", ...TAIL,
];
// Static content has no shoot: it goes straight from assignment to design.
const DESIGN_PATH: TaskStage[] = ["IDEA", "BRIEF", "ASSIGNED", "EDITING", "EDITING_REVIEW", ...TAIL];

const DESIGN_ONLY: ContentType[] = ["STATIC_POST", "CAROUSEL", "STORY"];

export function workflowPath(contentType: ContentType): TaskStage[] {
  return DESIGN_ONLY.includes(contentType) ? DESIGN_PATH : SHOOT_PATH;
}

/** Roles that may be the first assignee (the person who does the first real work). */
export function firstAssigneeRoles(contentType: ContentType): Role[] {
  switch (contentType) {
    case "STATIC_POST":
    case "CAROUSEL":
    case "STORY":
      return ["DESIGNER"];
    case "PRODUCT_PHOTOGRAPHY":
      return ["PHOTOGRAPHER"];
    case "PRODUCT_SHOOT":
      return ["PHOTOGRAPHER", "VIDEOGRAPHER"];
    default:
      return ["VIDEOGRAPHER"];
  }
}

/** Roles allowed to own a task while it sits in a given stage. */
export function stageOwnerRoles(stage: TaskStage): Role[] {
  switch (stage) {
    case "PRODUCTION":
      return ["VIDEOGRAPHER", "PHOTOGRAPHER"];
    case "EDITING":
      return ["VIDEO_EDITOR", "DESIGNER"];
    case "PRODUCTION_REVIEW":
    case "EDITING_REVIEW":
    case "INTERNAL_APPROVAL":
      return ["MARKETING_MANAGER", "SOCIAL_MEDIA_MANAGER", "ADMIN"];
    case "SOCIAL_APPROVAL":
    case "SCHEDULED":
    case "PUBLISHED":
      return ["SOCIAL_MEDIA_MANAGER", "ADMIN"];
    default:
      return ["SOCIAL_MEDIA_MANAGER", "MARKETING_MANAGER", "ADMIN"];
  }
}

export function nextStage(contentType: ContentType, from: TaskStage): TaskStage | null {
  const path = workflowPath(contentType);
  const i = path.indexOf(from);
  return i >= 0 && i < path.length - 1 ? path[i + 1] : null;
}

const REVISION_FROM: Partial<Record<TaskStage, TaskStage>> = {
  PRODUCTION_REVIEW: "PRODUCTION",
  EDITING_REVIEW: "EDITING",
  INTERNAL_APPROVAL: "EDITING",
  SOCIAL_APPROVAL: "EDITING",
};

/** Where a task goes back to when a reviewer requests changes. */
export function revisionTarget(contentType: ContentType, from: TaskStage): TaskStage | null {
  const target = REVISION_FROM[from];
  return target && workflowPath(contentType).includes(target) ? target : null;
}

/** Stages are never skipped or jumped to arbitrarily. */
export function canTransition(contentType: ContentType, from: TaskStage, to: TaskStage): boolean {
  return nextStage(contentType, from) === to || revisionTarget(contentType, from) === to;
}

export function initialStage(hasAssignee: boolean): TaskStage {
  return hasAssignee ? "ASSIGNED" : "BRIEF";
}

/** Stages in which the task may still be reassigned by a manager (Phase 2). */
export function isReassignable(stage: TaskStage): boolean {
  return ["IDEA", "BRIEF", "ASSIGNED", "PRODUCTION", "EDITING"].includes(stage);
}

// ───────── Phase 3: handover rules ─────────

import type { Permission } from "./rbac";

/** Permission needed to move a task OUT of a stage. */
export function exitPermission(from: TaskStage): Permission | null {
  switch (from) {
    case "PRODUCTION_REVIEW":
    case "EDITING_REVIEW":
    case "INTERNAL_APPROVAL":
      return "approval:internal";
    case "SOCIAL_APPROVAL":
      return "approval:final";
    case "SCHEDULED":
    case "PUBLISHED":
      return "publish:manage";
    default:
      return null;
  }
}

export interface HandoverRules {
  needsDeadline: boolean; // a deadline for the next stage
  needsDeliverables: boolean; // the sender must describe what they delivered
  requiredFileKind: "RAW" | "FINAL" | null; // at least one such file uploaded since the last handover
  needsPublishAt: boolean; // task must have a publishing date/time
}

export function handoverRules(from: TaskStage, to: TaskStage): HandoverRules {
  return {
    needsDeadline: !["SCHEDULED", "PUBLISHED", "COMPLETED"].includes(to),
    needsDeliverables: from === "PRODUCTION" || from === "EDITING",
    requiredFileKind: from === "PRODUCTION" ? "RAW" : from === "EDITING" ? "FINAL" : null,
    needsPublishAt: to === "SCHEDULED",
  };
}

/** ASSIGNED → next is entered by the assignee accepting, not by a handover. */
export function isHandoverStage(from: TaskStage): boolean {
  return !["IDEA", "BRIEF", "ASSIGNED", "COMPLETED"].includes(from);
}
