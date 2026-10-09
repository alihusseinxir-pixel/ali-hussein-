import { describe, expect, it } from "vitest";
import { timeAgo } from "./notification-ui";

describe("timeAgo", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  it("formats recent, minutes, hours and days", () => {
    expect(timeAgo("2026-10-05T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-10-05T11:30:00Z", now)).toBe("30 min ago");
    expect(timeAgo("2026-10-05T07:00:00Z", now)).toBe("5 h ago");
    expect(timeAgo("2026-10-02T12:00:00Z", now)).toBe("3 d ago");
  });
  it("never goes negative for clock skew", () => {
    expect(timeAgo("2026-10-05T12:00:30Z", now)).toBe("just now");
  });
});
