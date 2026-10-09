import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const entries = read(".env.example").split("\n").filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()] as const; });
const SENSITIVE = /(SECRET|PASSWORD|TOKEN|ACCESS_KEY|SMTP_URL|DATABASE_URL|CRON)/;

describe("secret hygiene", () => {
  it(".env.example documents the S3 variables by name", () => {
    const names = entries.map(([k]) => k);
    for (const n of ["S3_BUCKET", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) expect(names).toContain(n);
  });
  it(".env.example contains no values for anything sensitive", () => {
    const filled = entries.filter(([k, v]) => SENSITIVE.test(k) && v !== "");
    expect(filled).toEqual([]);
  });
  it(".env.example holds nothing that looks like a real credential", () => {
    const text = read(".env.example");
    expect(text).not.toMatch(/(AKIA|ASIA)[0-9A-Z]{16}/);
    expect(text).not.toMatch(/[A-Za-z0-9/+]{40}/); // 40-char secret-shaped strings
  });
  it(".gitignore excludes real env files but not the example", () => {
    const lines = read(".gitignore").split("\n").map((l) => l.trim());
    expect(lines).toContain(".env");
    expect(lines).toContain(".env.*");
    expect(lines).toContain("!.env.example");
  });
  it("git really ignores .env / .env.local / .env.production, and tracks only .env.example", () => {
    const ignored = (f: string) => { try { execFileSync("git", ["check-ignore", "-q", f], { cwd: root }); return true; } catch { return false; } };
    for (const f of [".env", ".env.local", ".env.production", "uploads/x.png"]) expect(ignored(f), f).toBe(true);
    expect(ignored(".env.example")).toBe(false);
    const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter((f) => /(^|\/)\.env(\.|$)/.test(f));
    expect(tracked).toEqual([".env.example"]);
  });
  it("no source file hardcodes AWS credentials or enables public ACLs", () => {
    const files = execFileSync("git", ["ls-files", "src", "scripts"], { cwd: root, encoding: "utf8" }).split("\n").filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test."));
    for (const f of files) {
      const t = read(f);
      expect(t, f).not.toMatch(/(AKIA|ASIA)[0-9A-Z]{16}/);
      expect(t, f).not.toMatch(/ACL:\s*["']public/);
      expect(t, f).not.toMatch(/x-amz-acl/i);
    }
  });
});
