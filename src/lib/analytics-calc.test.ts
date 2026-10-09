import { describe, expect, it } from "vitest";
import { approvalTimes, byContentType, campaignStats, completionTimes, deliveries, formatDuration, overview, peopleStats, volumeSeries, type AApproval, type AHandoff, type ATask } from "./analytics-calc";

const d = (s: string) => new Date(`2026-10-${s}Z`);
const NOW = d("20T12:00:00");
const range = { from: d("01T00:00:00"), to: d("21T00:00:00") };
const task = (o: Partial<ATask> & { id: string }): ATask => ({ contentType: "REEL", stage: "PRODUCTION", createdAt: d("02T09:00:00"), deadline: null, campaignId: null, currentAssigneeId: null, ...o });
const ho = (taskId: string, fromUserId: string, toUserId: string, fromStage: AHandoff["fromStage"], toStage: AHandoff["toStage"], at: string): AHandoff => ({ taskId, fromUserId, toUserId, fromStage, toStage, createdAt: d(at) });

// t1: full life. mgr assigns to vid (02 09:00) → vid delivers to rev (03 09:00 = 24h) → rev sends to ed (03 12:00)
//     → ed delivers (04 12:00 = 24h) to rev → rev sends back (revision) → ed delivers again (05 00:00 = 12h) → … published 06.
const H: AHandoff[] = [
  ho("t1", "mgr", "vid", "BRIEF", "ASSIGNED", "02T09:00:00"),
  ho("t1", "vid", "rev", "PRODUCTION", "PRODUCTION_REVIEW", "03T09:00:00"),
  ho("t1", "rev", "ed", "PRODUCTION_REVIEW", "EDITING", "03T12:00:00"),
  ho("t1", "ed", "rev", "EDITING", "EDITING_REVIEW", "04T12:00:00"),
  ho("t1", "rev", "ed", "EDITING_REVIEW", "EDITING", "04T14:00:00"), // revision → ed
  ho("t1", "ed", "rev", "EDITING", "EDITING_REVIEW", "05T02:00:00"), // 12h
  ho("t1", "rev", "sm", "EDITING_REVIEW", "INTERNAL_APPROVAL", "05T08:00:00"),
  ho("t1", "sm", "sm", "SOCIAL_APPROVAL", "SCHEDULED", "05T20:00:00"),
  ho("t1", "sm", "sm", "SCHEDULED", "PUBLISHED", "06T09:00:00"),
];
const A: AApproval[] = [
  { taskId: "t1", approverId: "rev", stage: "PRODUCTION_REVIEW", status: "APPROVED", createdAt: d("03T12:00:00") }, // entered 03 09:00 → 3h
  { taskId: "t1", approverId: "rev", stage: "EDITING_REVIEW", status: "CHANGES_REQUESTED", createdAt: d("04T14:00:00") }, // entered 04 12:00 → 2h
  { taskId: "t1", approverId: "rev", stage: "EDITING_REVIEW", status: "APPROVED", createdAt: d("05T08:00:00") }, // entered 05 02:00 → 6h
];
const tasks: ATask[] = [
  task({ id: "t1", stage: "PUBLISHED", createdAt: d("02T09:00:00"), campaignId: "c1" }),
  task({ id: "t2", stage: "EDITING", currentAssigneeId: "ed", deadline: d("10T00:00:00"), campaignId: "c1", createdAt: d("08T00:00:00") }), // overdue
  task({ id: "t3", stage: "PRODUCTION", currentAssigneeId: "vid", deadline: d("25T00:00:00"), createdAt: d("19T00:00:00"), contentType: "STORY" }),
  task({ id: "old", stage: "BRIEF", createdAt: new Date("2026-08-01T00:00:00Z") }),
];

describe("completion + deliveries", () => {
  it("finds the first publication time", () => {
    expect(completionTimes(H).get("t1")).toEqual(d("06T09:00:00"));
    expect(completionTimes([]).size).toBe(0);
  });
  it("measures receipt → hand-forward per person, including loops, and ignores revisions/reassignments", () => {
    const ds = deliveries(H).map((x) => [x.userId, x.stage, x.hours]);
    expect(ds).toEqual([["vid", "PRODUCTION", 24], ["ed", "EDITING", 24], ["ed", "EDITING", 12]]);
    // reassignment aborts the interval: nobody delivers
    const re = [ho("x", "mgr", "vid", "BRIEF", "ASSIGNED", "02T00:00:00"), ho("x", "mgr", "vid2", "ASSIGNED", "ASSIGNED", "03T00:00:00"), ho("x", "vid2", "rev", "PRODUCTION", "PRODUCTION_REVIEW", "04T00:00:00")];
    expect(deliveries(re).map((x) => [x.userId, x.hours])).toEqual([["vid2", 24]]);
  });
  it("times reviewer decisions from the moment the task reached them", () => {
    expect(approvalTimes(A, H).map((a) => a.hours)).toEqual([3, 2, 6]);
  });
});

describe("overview", () => {
  const o = overview(tasks, H, A, range, NOW);
  it("counts volume and state", () => {
    expect(o).toMatchObject({ created: 3, completed: 1, open: 3, overdue: 1 });
  });
  it("averages time to publish, approval time and revision rate", () => {
    expect(o.avgDaysToPublish).toBe(4); // 02 09:00 → 06 09:00
    expect(o.avgApprovalHours).toBe(3.7); // (3+2+6)/3
    expect(o.reviewed).toBe(1); expect(o.revised).toBe(1); expect(o.revisionRate).toBe(100);
  });
  it("respects the range", () => {
    const narrow = overview(tasks, H, A, { from: d("10T00:00:00"), to: d("21T00:00:00") }, NOW);
    expect(narrow.completed).toBe(0); expect(narrow.avgDaysToPublish).toBeNull(); expect(narrow.revisionRate).toBeNull();
    expect(narrow.created).toBe(1);
  });
});

describe("people", () => {
  const p = Object.fromEntries(peopleStats(["vid", "ed", "rev", "nobody"], tasks, H, A, range, NOW).map((x) => [x.userId, x]));
  it("credits deliveries and delivery time", () => {
    expect(p.vid).toMatchObject({ delivered: 1, avgDeliveryHours: 24, open: 1, overdue: 0, revisionsReceived: 0, revisionRate: 0 });
    expect(p.ed).toMatchObject({ delivered: 2, avgDeliveryHours: 18, open: 1, overdue: 1 });
  });
  it("charges revisions to the person who received the work back", () => {
    expect(p.ed).toMatchObject({ revisionsReceived: 1, revisionRate: 50 });
  });
  it("tracks reviewers", () => {
    expect(p.rev).toMatchObject({ approvalsGiven: 3, avgApprovalHours: 3.7, delivered: 0, revisionRate: null });
  });
  it("is empty-safe", () => {
    expect(p.nobody).toMatchObject({ delivered: 0, avgDeliveryHours: null, open: 0, overdue: 0, approvalsGiven: 0 });
  });
});

describe("volume series and breakdowns", () => {
  it("fills empty weeks and counts created vs published per bucket (Sunday weeks)", () => {
    const s = volumeSeries(tasks, H, range, "week", "UTC", 0);
    expect(s.every((b, i) => i === 0 || s[i - 1].key < b.key)).toBe(true);
    expect(s.reduce((a, b) => a + b.created, 0)).toBe(3);
    expect(s.reduce((a, b) => a + b.published, 0)).toBe(1);
    expect(s.find((b) => b.published === 1)?.key).toBe("2026-10-04"); // Sunday of the week containing Oct 6
  });
  it("buckets by month", () => {
    const s = volumeSeries(tasks, H, { from: new Date("2026-07-01Z"), to: new Date("2026-11-01Z") }, "month", "UTC", 0);
    expect(s.map((b) => b.key)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(s.find((b) => b.key === "2026-10")).toMatchObject({ created: 3, published: 1 });
  });
  it("breaks volume down by content type", () => {
    expect(byContentType(tasks, H, range)).toEqual([{ type: "REEL", created: 2, published: 1 }, { type: "STORY", created: 1, published: 0 }]);
  });
});

describe("campaigns", () => {
  it("reports lifetime progress, overdue, lead time and revision rate", () => {
    const [c] = campaignStats(["c1"], tasks, H, NOW);
    expect(c).toMatchObject({ total: 2, published: 1, percent: 50, overdue: 1, avgDaysToPublish: 4, revisionRate: 100 });
    expect(campaignStats(["none"], tasks, H, NOW)[0]).toMatchObject({ total: 0, percent: 0, avgDaysToPublish: null, revisionRate: null });
  });
});

describe("formatDuration", () => {
  it("picks a readable unit", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0.2)).toBe("12 د");
    expect(formatDuration(5.04)).toBe("5 س");
    expect(formatDuration(36)).toBe("36 س");
    expect(formatDuration(72)).toBe("3 ي");
  });
});
