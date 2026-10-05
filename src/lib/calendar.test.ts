import { describe, expect, it } from "vitest";
import { addDays, addMonths, dayKey, daysFor, eventsForTask, layoutLanes, minutesOfDay, utcRange } from "./calendar";

const base = { title: "Reel", contentType: "REEL" as const, stage: "PRODUCTION" as const, deadline: null, shootingAt: null, publishAt: null, currentAssigneeId: "u1" };
const d = (s: string) => new Date(s);

describe("eventsForTask", () => {
  it("creates shooting, deadline and publishing events from task dates", () => {
    const ev = eventsForTask({ ...base, shootingAt: d("2026-10-07T13:00Z"), deadline: d("2026-10-08T09:00Z"), publishAt: d("2026-10-10T17:00Z") },
      { owner: { id: "u1", role: "VIDEOGRAPHER" }, production: { id: "u1", role: "VIDEOGRAPHER" } });
    expect(ev.map((e) => e.type).sort()).toEqual(["PUBLISHING", "SHOOTING", "SHOOTING"]);
    expect(ev.find((e) => e.title.startsWith("Shooting"))?.userId).toBe("u1");
  });
  it("types the deadline by the current stage and owner", () => {
    const own = (role: "VIDEO_EDITOR" | "DESIGNER") => ({ owner: { id: "x", role }, production: null });
    const t = { ...base, deadline: d("2026-10-08T09:00Z") };
    expect(eventsForTask({ ...t, stage: "EDITING" }, own("VIDEO_EDITOR"))[0].type).toBe("EDITING");
    expect(eventsForTask({ ...t, stage: "EDITING" }, own("DESIGNER"))[0].type).toBe("DESIGN");
    expect(eventsForTask({ ...t, stage: "INTERNAL_APPROVAL" }, own("DESIGNER"))[0].type).toBe("REVIEW");
    expect(eventsForTask({ ...t, contentType: "CAROUSEL", stage: "ASSIGNED" }, { owner: null, production: null })[0].type).toBe("DESIGN");
  });
  it("uses photography for product photography and drops deadlines once scheduled", () => {
    const ev = eventsForTask({ ...base, contentType: "PRODUCT_PHOTOGRAPHY", shootingAt: d("2026-10-07T13:00Z") }, { owner: null, production: null });
    expect(ev[0].type).toBe("PHOTOGRAPHY");
    expect(eventsForTask({ ...base, stage: "SCHEDULED", deadline: d("2026-10-08T09:00Z") }, { owner: null, production: null })).toHaveLength(0);
  });
});

describe("date math", () => {
  it("adds days/months across boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
  });
  it("builds month grids of whole weeks and week/day views", () => {
    const m = daysFor("month", "2026-10-15", 0);
    expect(m.length % 7).toBe(0);
    expect(m).toContain("2026-10-01"); expect(m).toContain("2026-10-31");
    expect(new Date(m[0] + "T00:00Z").getUTCDay()).toBe(0);
    expect(daysFor("week", "2026-10-07", 0)).toEqual(["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(daysFor("week", "2026-10-07", 1)[0]).toBe("2026-10-05");
    expect(daysFor("day", "2026-10-07")).toEqual(["2026-10-07"]);
  });
  it("converts between local days and UTC in the org timezone", () => {
    const tz = "Asia/Riyadh";
    expect(dayKey(d("2026-10-07T21:30Z"), tz)).toBe("2026-10-08"); // 00:30 local next day
    expect(minutesOfDay(d("2026-10-07T13:00Z"), tz)).toBe(16 * 60);
    const r = utcRange(["2026-10-07", "2026-10-08"], tz);
    expect(r.from.toISOString()).toBe("2026-10-06T21:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-08T21:00:00.000Z");
  });
});

describe("layoutLanes", () => {
  it("places overlapping events side by side and separate ones full width", () => {
    const r = layoutLanes([{ start: 60, end: 120 }, { start: 90, end: 150 }, { start: 300, end: 360 }]);
    expect(r.map((x) => [x.lane, x.lanes])).toEqual([[0, 2], [1, 2], [0, 1]]);
  });
});
