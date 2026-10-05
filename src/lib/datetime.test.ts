import { describe, expect, it } from "vitest";
import { parseLocalDateTime, toLocalInput } from "./datetime";

describe("datetime", () => {
  it("converts Riyadh wall-clock to UTC (UTC+3)", () => {
    expect(parseLocalDateTime("2026-10-07T16:00", "Asia/Riyadh")?.toISOString()).toBe("2026-10-07T13:00:00.000Z");
  });
  it("round-trips", () => {
    const d = parseLocalDateTime("2026-10-07T16:00", "Asia/Riyadh");
    expect(toLocalInput(d, "Asia/Riyadh")).toBe("2026-10-07T16:00");
  });
  it("handles DST zones", () => {
    expect(parseLocalDateTime("2026-07-01T12:00", "America/New_York")?.toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(parseLocalDateTime("2026-01-01T12:00", "America/New_York")?.toISOString()).toBe("2026-01-01T17:00:00.000Z");
  });
  it("rejects garbage and empty", () => {
    expect(parseLocalDateTime("", "UTC")).toBeNull();
    expect(parseLocalDateTime("tomorrow", "UTC")).toBeNull();
  });
});
