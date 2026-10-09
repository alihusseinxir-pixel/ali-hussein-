import { beforeAll, describe, expect, it } from "vitest";
import { makeUploadToken, parseUploadToken, type UploadClaim } from "./upload-token";

const claim: UploadClaim = { taskId: "t1", userId: "u1", key: "pending/o/t1/x.png", fileName: "shot.png", kind: "RAW", commentId: null, size: 123, mime: "image/png" };
beforeAll(() => { process.env.SESSION_SECRET = "z".repeat(40); });

describe("upload tokens", () => {
  it("round-trips a claim", () => {
    expect(parseUploadToken(makeUploadToken(claim, 60))).toEqual(claim);
    expect(parseUploadToken(makeUploadToken({ ...claim, commentId: "c1" }, 60))?.commentId).toBe("c1");
  });
  it("rejects expiry, tampering and junk", () => {
    expect(parseUploadToken(makeUploadToken(claim, 60, Date.now() - 120_000))).toBeNull();
    const [body, sig] = makeUploadToken(claim, 60).split(".");
    const forged = Buffer.from(JSON.stringify({ ...claim, key: "pending/other/victim.png", e: 9999999999 })).toString("base64url");
    expect(parseUploadToken(`${forged}.${sig}`)).toBeNull();
    expect(parseUploadToken(`${body}.${sig.slice(0, -2)}AA`)).toBeNull();
    for (const bad of ["", "x", "a.b.c", `${body}.`]) expect(parseUploadToken(bad)).toBeNull();
  });
  it("is bound to the signing secret", () => {
    const t = makeUploadToken(claim, 60);
    process.env.SESSION_SECRET = "q".repeat(40);
    expect(parseUploadToken(t)).toBeNull();
    process.env.SESSION_SECRET = "z".repeat(40);
  });
});
