import { describe, expect, it } from "vitest";
import { verifyCronAuth } from "./cron-auth";

const secret = "a-long-random-secret-123";
describe("verifyCronAuth", () => {
  it("accepts only the exact bearer secret", () => {
    expect(verifyCronAuth(`Bearer ${secret}`, secret)).toBe(true);
    expect(verifyCronAuth(`Bearer ${secret}x`, secret)).toBe(false);
    expect(verifyCronAuth(secret, secret)).toBe(false);
    expect(verifyCronAuth(null, secret)).toBe(false);
    expect(verifyCronAuth("Bearer ", secret)).toBe(false);
  });
  it("is disabled without a (long enough) secret", () => {
    expect(verifyCronAuth("Bearer ", undefined)).toBe(false);
    expect(verifyCronAuth("Bearer short", "short")).toBe(false);
  });
});
