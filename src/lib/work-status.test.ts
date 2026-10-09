import { describe, expect, it } from "vitest";
import type { TaskStage } from "@prisma/client";
import { WORK_STATUSES, workStatus } from "./work-status";

const STAGES: TaskStage[] = ["IDEA", "BRIEF", "ASSIGNED", "PRODUCTION", "PRODUCTION_REVIEW", "EDITING", "EDITING_REVIEW", "INTERNAL_APPROVAL", "SOCIAL_APPROVAL", "SCHEDULED", "PUBLISHED", "COMPLETED"];

describe("work status", () => {
  it("maps every stage to exactly one status", () => { for (const s of STAGES) expect(WORK_STATUSES).toContain(workStatus(s, false)); });
  it("maps the stage groups", () => {
    expect(["IDEA", "BRIEF", "ASSIGNED"].map((s) => workStatus(s as TaskStage, false))).toEqual(["TODO", "TODO", "TODO"]);
    expect(["PRODUCTION", "EDITING"].map((s) => workStatus(s as TaskStage, false))).toEqual(["IN_PROGRESS", "IN_PROGRESS"]);
    expect(["PRODUCTION_REVIEW", "EDITING_REVIEW", "INTERNAL_APPROVAL", "SOCIAL_APPROVAL"].map((s) => workStatus(s as TaskStage, false)).every((x) => x === "IN_REVIEW")).toBe(true);
    expect(["SCHEDULED", "PUBLISHED", "COMPLETED"].map((s) => workStatus(s as TaskStage, false)).every((x) => x === "DONE")).toBe(true);
  });
  it("an open revision request only matters while work is in progress", () => {
    expect(workStatus("EDITING", true)).toBe("CHANGES_REQUESTED");
    expect(workStatus("PRODUCTION", true)).toBe("CHANGES_REQUESTED");
    expect(workStatus("EDITING_REVIEW", true)).toBe("IN_REVIEW");
    expect(workStatus("PUBLISHED", true)).toBe("DONE");
  });
});
