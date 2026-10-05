import { describe, expect, it } from "vitest";
import { canTransition, firstAssigneeRoles, initialStage, nextStage, revisionTarget, workflowPath } from "./workflow";

describe("workflow", () => {
  it("video content goes through production and editing", () => {
    expect(workflowPath("REEL")).toContain("PRODUCTION");
    expect(nextStage("REEL", "ASSIGNED")).toBe("PRODUCTION");
  });
  it("static content skips production", () => {
    expect(workflowPath("STATIC_POST")).not.toContain("PRODUCTION");
    expect(nextStage("STATIC_POST", "ASSIGNED")).toBe("EDITING");
  });
  it("does not allow skipping or arbitrary jumps", () => {
    expect(canTransition("REEL", "PRODUCTION", "PUBLISHED")).toBe(false);
    expect(canTransition("REEL", "BRIEF", "EDITING")).toBe(false);
    expect(canTransition("REEL", "COMPLETED", "IDEA")).toBe(false);
  });
  it("allows forward steps and revision loops only", () => {
    expect(canTransition("REEL", "PRODUCTION", "PRODUCTION_REVIEW")).toBe(true);
    expect(canTransition("REEL", "EDITING_REVIEW", "EDITING")).toBe(true);
    expect(canTransition("REEL", "SOCIAL_APPROVAL", "EDITING")).toBe(true);
    expect(canTransition("REEL", "PRODUCTION", "BRIEF")).toBe(false);
  });
  it("has no revision target for non-review stages", () => {
    expect(revisionTarget("REEL", "PRODUCTION")).toBeNull();
    expect(revisionTarget("STATIC_POST", "PRODUCTION_REVIEW")).toBeNull();
  });
  it("ends at COMPLETED", () => {
    expect(nextStage("REEL", "COMPLETED")).toBeNull();
  });
  it("maps first assignee roles by content type", () => {
    expect(firstAssigneeRoles("REEL")).toEqual(["VIDEOGRAPHER"]);
    expect(firstAssigneeRoles("PRODUCT_PHOTOGRAPHY")).toEqual(["PHOTOGRAPHER"]);
    expect(firstAssigneeRoles("CAROUSEL")).toEqual(["DESIGNER"]);
  });
  it("starts ASSIGNED only with an assignee", () => {
    expect(initialStage(true)).toBe("ASSIGNED");
    expect(initialStage(false)).toBe("BRIEF");
  });
});

import { exitPermission, handoverRules, isHandoverStage } from "./workflow";
describe("handover rules", () => {
  it("requires deliverables when leaving a work stage", () => {
    expect(handoverRules("PRODUCTION", "PRODUCTION_REVIEW").needsDeliverables).toBe(true);
    expect(handoverRules("PRODUCTION_REVIEW", "EDITING").needsDeliverables).toBe(false);
  });
  it("requires publishAt only for scheduling and no deadline for the tail", () => {
    expect(handoverRules("SOCIAL_APPROVAL", "SCHEDULED")).toMatchObject({ needsPublishAt: true, needsDeadline: false });
    expect(handoverRules("EDITING", "EDITING_REVIEW").needsDeadline).toBe(true);
  });
  it("gates exits by permission and excludes pre-work stages", () => {
    expect(exitPermission("SOCIAL_APPROVAL")).toBe("approval:final");
    expect(exitPermission("PRODUCTION")).toBeNull();
    expect(isHandoverStage("ASSIGNED")).toBe(false);
    expect(isHandoverStage("PRODUCTION")).toBe(true);
  });
});

describe("file requirements", () => {
  it("needs raw files leaving production and final files leaving editing", () => {
    expect(handoverRules("PRODUCTION", "PRODUCTION_REVIEW").requiredFileKind).toBe("RAW");
    expect(handoverRules("EDITING", "EDITING_REVIEW").requiredFileKind).toBe("FINAL");
    expect(handoverRules("EDITING_REVIEW", "INTERNAL_APPROVAL").requiredFileKind).toBeNull();
  });
});
