import { describe, expect, it } from "vitest";
import { can } from "./rbac";

describe("rbac", () => {
  it("admin can do everything", () => {
    expect(can("ADMIN", "user:manage")).toBe(true);
    expect(can("ADMIN", "task:delete")).toBe(true);
  });
  it("production roles cannot create or see all tasks or manage users", () => {
    for (const r of ["VIDEOGRAPHER", "PHOTOGRAPHER", "VIDEO_EDITOR", "DESIGNER"] as const) {
      expect(can(r, "task:create")).toBe(false);
      expect(can(r, "task:view:all")).toBe(false);
      expect(can(r, "user:manage")).toBe(false);
      expect(can(r, "task:comment")).toBe(true);
    }
  });
  it("only admin manages users and settings", () => {
    expect(can("MARKETING_MANAGER", "user:manage")).toBe(false);
    expect(can("SOCIAL_MEDIA_MANAGER", "org:settings")).toBe(false);
  });
  it("social media manager gives final approval", () => {
    expect(can("SOCIAL_MEDIA_MANAGER", "approval:final")).toBe(true);
    expect(can("MARKETING_MANAGER", "approval:final")).toBe(false);
  });
});
