import { describe, expect, it } from "vitest";
import { describeError, redact } from "./log-safe";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
// Fake values assembled at runtime so no credential-shaped literal exists anywhere in the repository (or its scanners' view).
const FAKE_KEY_ID = ["AKIA", "FAKEFAKE", "FAKE1234"].join("");
const FAKE_URL_KEY_ID = ["AKIA", "ABCDEFGH", "IJKLMNOP"].join("");
const FAKE_SECRET = ["fake/secret", "key+not/real", "0123456789"].join("-");
describe("redact", () => {
  it("removes the configured secrets wherever they appear", () => {
    const e = env({ AWS_SECRET_ACCESS_KEY: FAKE_SECRET, AWS_ACCESS_KEY_ID: FAKE_KEY_ID, SESSION_SECRET: "super-long-session-secret-value", AWS_REGION: "eu-west-1" });
    const out = redact(`denied for ${FAKE_SECRET} key ${FAKE_KEY_ID} sess super-long-session-secret-value region eu-west-1`, e);
    expect(out).not.toContain(FAKE_SECRET);
    expect(out).not.toContain(FAKE_KEY_ID);
    expect(out).not.toContain("super-long-session-secret-value");
    expect(out).toContain("eu-west-1"); // non-sensitive config is kept: logs stay useful
  });
  it("scrubs credential-shaped text even when the value is not in the environment", () => {
    const out = redact(`PUT https://b.s3.amazonaws.com/k?X-Amz-Credential=${FAKE_URL_KEY_ID}%2F2026%2Fs3&X-Amz-Signature=deadbeef0123&X-Amz-Expires=300 failed`, env({}));
    expect(out).not.toContain(FAKE_URL_KEY_ID);
    expect(out).not.toContain("deadbeef0123");
    expect(out).toContain("X-Amz-Expires=300");
    expect(redact("aws_secret_access_key = abcdefghijklmnopqrstuvwxyz0123456789ABCD", env({}))).toContain("[redacted]");
    expect(redact("postgresql://basma:hunter2hunter2@localhost/db", env({}))).toBe("postgresql://basma:[redacted]@localhost/db");
    expect(redact("Authorization: Bearer abcdefghijklmnop.qrstuv", env({}))).toContain("Bearer [redacted]");
  });
  it("leaves ordinary text and short values alone", () => {
    expect(redact("Task BASMA-2026-00001 not found", env({ SESSION_SECRET: "short" }))).toBe("Task BASMA-2026-00001 not found");
  });
});

describe("describeError", () => {
  it("logs name, message and HTTP status — never the raw object", () => {
    const err = Object.assign(new Error("Access Denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 }, config: { credentials: { secretAccessKey: "NOPE-SHOULD-NOT-APPEAR" } } });
    const s = describeError(err, env({}));
    expect(s).toBe("AccessDenied: Access Denied (HTTP 403)");
    expect(s).not.toContain("NOPE");
  });
  it("handles non-errors", () => {
    expect(describeError("plain", env({}))).toBe("plain");
  });
});
