import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { GET } from "./route";

afterEach(() => { vi.restoreAllMocks(); });

describe("GET /api/health", () => {
  it("reports ok when the database answers", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("reports 503 without leaking any error detail when the database is down", async () => {
    vi.spyOn(db, "$queryRaw").mockRejectedValue(new Error("connect ECONNREFUSED postgresql://user:secret@host/db"));
    const res = await GET();
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).toBe('{"status":"unavailable"}');
    expect(text).not.toMatch(/secret|ECONNREFUSED|postgres/);
  });
});
