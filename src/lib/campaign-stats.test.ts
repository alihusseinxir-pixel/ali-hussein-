import { describe, expect, it } from "vitest";
import { BUCKETS, bucketOf, summarize } from "./campaign-stats";
import { STAGE_LABELS } from "./workflow";

describe("campaign stats", () => {
  it("maps every workflow stage to a bucket", () => {
    for (const s of Object.keys(STAGE_LABELS)) expect(BUCKETS).toContain(bucketOf(s as never));
  });
  it("summarises counts and progress", () => {
    const s = summarize({ BRIEF: 2, PRODUCTION: 1, EDITING_REVIEW: 1, PUBLISHED: 1, COMPLETED: 3 }, 2);
    expect(s.total).toBe(8);
    expect(s.buckets).toMatchObject({ planning: 2, production: 1, editing: 1, published: 4 });
    expect(s.percent).toBe(50);
    expect(s.overdue).toBe(2);
  });
  it("handles an empty campaign", () => {
    expect(summarize({})).toMatchObject({ total: 0, percent: 0 });
  });
});
