import { describe, expect, it } from "vitest";
import type { ScriptStatus } from "@prisma/client";
import { EDITABLE, SCRIPT_TRANSITIONS, allowedTransitions, findTransition } from "./script-workflow";

const ALL: ScriptStatus[] = ["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "READY_FOR_PRODUCTION"];

describe("script workflow", () => {
  it("defines transitions for every status", () => { for (const s of ALL) expect(SCRIPT_TRANSITIONS[s]).toBeDefined(); });
  it("only reviewers can approve or request changes; editors cannot", () => {
    expect(findTransition("IN_REVIEW", "APPROVED")?.who).toBe("reviewer");
    expect(allowedTransitions("IN_REVIEW", { editor: true, reviewer: false }).map((t) => t.to)).toEqual(["DRAFT"]);
  });
  it("never reaches APPROVED or READY_FOR_PRODUCTION from DRAFT directly", () => {
    expect(findTransition("DRAFT", "APPROVED")).toBeUndefined();
    expect(findTransition("DRAFT", "READY_FOR_PRODUCTION")).toBeUndefined();
    expect(findTransition("CHANGES_REQUESTED", "APPROVED")).toBeUndefined();
  });
  it("requires a note when requesting changes and locks scenes outside draft/changes-requested", () => {
    expect(findTransition("IN_REVIEW", "CHANGES_REQUESTED")?.needsNote).toBe(true);
    expect(EDITABLE).toEqual(["DRAFT", "CHANGES_REQUESTED"]);
  });
});
