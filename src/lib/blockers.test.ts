import { describe, expect, it } from "vitest";
import { shootBlockers } from "./blockers";

const now = new Date("2026-11-10T08:00:00Z");
const shoot = (over = {}) => ({ id: "s1", title: "تصوير", startsAt: new Date("2026-11-11T09:00:00Z"), warningCount: 0, contents: [{ task: { id: "t1", title: "ريل", scriptStatus: "READY_FOR_PRODUCTION" as const } }], ...over });

describe("shoot blockers", () => {
  it("is empty when scripts are cleared and there are no warnings", () => { expect(shootBlockers(shoot(), now)).toEqual([]); });
  it("flags every linked content whose script is not approved", () => {
    const b = shootBlockers(shoot({ contents: [
      { task: { id: "a", title: "A", scriptStatus: "DRAFT" } }, { task: { id: "b", title: "B", scriptStatus: "IN_REVIEW" } },
      { task: { id: "c", title: "C", scriptStatus: "CHANGES_REQUESTED" } }, { task: { id: "d", title: "D", scriptStatus: "APPROVED" } } ] }), now);
    expect(b.map((x) => x.href)).toEqual(["/tasks/a/script", "/tasks/b/script", "/tasks/c/script"]);
  });
  it("flags warnings and words the due date", () => {
    expect(shootBlockers(shoot({ warningCount: 2 }), now)[0].message).toContain("غداً");
    expect(shootBlockers(shoot({ warningCount: 1, startsAt: new Date("2026-11-10T12:00:00Z") }), now)[0].message).toContain("اليوم");
    expect(shootBlockers(shoot({ warningCount: 1, startsAt: new Date("2026-11-12T09:00:00Z") }), now)[0].message).toContain("بعد يومين");
    expect(shootBlockers(shoot({ warningCount: 1, startsAt: new Date("2026-11-14T09:00:00Z") }), now)[0].message).toContain("بعد 4 أيام");
  });
});
