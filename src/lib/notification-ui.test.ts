import { describe, expect, it } from "vitest";
import { timeAgo } from "./notification-ui";

describe("timeAgo", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  it("formats recent, minutes, hours and days", () => {
    expect(timeAgo("2026-10-05T11:59:40Z", now)).toBe("الآن");
    expect(timeAgo("2026-10-05T11:30:00Z", now)).toBe("قبل 30 د");
    expect(timeAgo("2026-10-05T07:00:00Z", now)).toBe("قبل 5 س");
    expect(timeAgo("2026-10-02T12:00:00Z", now)).toBe("قبل 3 ي");
  });
  it("never goes negative for clock skew", () => {
    expect(timeAgo("2026-10-05T12:00:30Z", now)).toBe("الآن");
  });
});
