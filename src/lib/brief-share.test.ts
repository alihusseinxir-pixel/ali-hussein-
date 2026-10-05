import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => { process.env.SESSION_SECRET = "x".repeat(40); });

describe("share tokens", () => {
  it("round-trips and rejects tampering, expiry and malformed input", async () => {
    const { makeToken, parseToken } = await import("./brief-share");
    const tok = makeToken("task1", 3, new Date(Date.now() + 60_000));
    expect(parseToken(tok)).toEqual({ taskId: "task1", version: 3 });
    expect(parseToken(makeToken("task1", 3, new Date(Date.now() - 1000)))).toBeNull(); // expired
    const [body, sig] = tok.split(".");
    const forged = Buffer.from(JSON.stringify({ t: "task2", v: 3, e: 9999999999 })).toString("base64url");
    expect(parseToken(`${forged}.${sig}`)).toBeNull(); // payload swapped, signature kept
    expect(parseToken(`${body}.${sig.slice(0, -2)}AA`)).toBeNull();
    for (const bad of ["", "abc", "a.b.c", `${body}.`, `.${sig}`]) expect(parseToken(bad)).toBeNull();
  });
  it("tokens signed with another secret are rejected", async () => {
    const { makeToken } = await import("./brief-share");
    const tok = makeToken("t", 0, new Date(Date.now() + 60_000));
    process.env.SESSION_SECRET = "y".repeat(40);
    const { parseToken } = await import("./brief-share");
    expect(parseToken(tok)).toBeNull();
    process.env.SESSION_SECRET = "x".repeat(40);
  });
});
