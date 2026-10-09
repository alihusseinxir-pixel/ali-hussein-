import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import S3rver from "s3rver";
import { createS3Storage, s3ConfigFromEnv } from "./storage-s3";
import { driverName } from "./storage";
import type { Storage } from "./storage";

const read = async (s: Readable) => { const p: Buffer[] = []; for await (const c of s) p.push(Buffer.from(c)); return Buffer.concat(p); };
const dir = mkdtempSync(path.join(tmpdir(), "basma-direct-"));
let server: S3rver, s: Storage;

beforeAll(async () => {
  server = new S3rver({ port: 0, address: "127.0.0.1", silent: true, directory: dir, configureBuckets: [{ name: "b", configs: [] }] });
  const addr = (await server.run()) as { port: number };
  s = createS3Storage({ bucket: "b", region: "us-east-1", endpoint: `http://127.0.0.1:${addr.port}`, forcePathStyle: true, accessKeyId: "S3RVER", secretAccessKey: "S3RVER" });
});
afterAll(async () => { await server?.close(); rmSync(dir, { recursive: true, force: true }); });

describe("presigned (direct) access", () => {
  it("exposes direct capabilities", () => { expect(s.direct).toBeDefined(); });

  it("uploads with a presigned PUT, then reads the same bytes back", async () => {
    const data = Buffer.from("hello presigned world");
    const { url, headers } = await s.direct!.presignUpload("pending/o/t/a.pdf", { contentType: "application/pdf", contentLength: data.length, expiresSeconds: 60 });
    expect(url).toContain("X-Amz-Signature=");
    const res = await fetch(url, { method: "PUT", headers, body: data });
    expect(res.status).toBe(200);
    expect(await s.size("pending/o/t/a.pdf")).toBe(data.length);
    expect((await read(await s.get("pending/o/t/a.pdf"))).equals(data)).toBe(true);
  });

  it("puts the content type and exact length into the signature (S3 itself enforces them)", async () => {
    // The in-process emulator does not enforce signed headers, real S3 answers 403 SignatureDoesNotMatch to a
    // different type/length. What we can and do verify: both headers are part of the signed set, and the server
    // re-checks size and file signature after upload anyway (see files.direct.integration.test.ts).
    const { url, headers } = await s.direct!.presignUpload("pending/o/t/b.pdf", { contentType: "application/pdf", contentLength: 3, expiresSeconds: 60 });
    const signed = new URL(url).searchParams.get("X-Amz-SignedHeaders")!.split(";");
    expect(signed).toEqual(expect.arrayContaining(["content-type", "content-length", "host"]));
    expect(headers).toEqual({ "Content-Type": "application/pdf", "Content-Length": "3" });
  });

  it("moves an object (copy + delete) inside the bucket", async () => {
    await s.direct!.move("pending/o/t/a.pdf", "o/t/final.pdf");
    expect(await s.size("o/t/final.pdf")).toBe(21);
    await expect(s.size("pending/o/t/a.pdf")).rejects.toThrow();
  });

  it("presigns downloads that carry our type and disposition, including non-Latin names", async () => {
    const url = await s.direct!.presignDownload("o/t/final.pdf", { contentType: "application/pdf", fileName: "طازج (v2).pdf", inline: false, expiresSeconds: 60 });
    const u = new URL(url);
    expect(u.searchParams.get("response-content-type")).toBe("application/pdf");
    expect(u.searchParams.get("response-content-disposition")).toBe("attachment; filename*=UTF-8''%D8%B7%D8%A7%D8%B2%D8%AC%20%28v2%29.pdf");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("60");
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("hello presigned world");
    expect((await fetch(url, { headers: { Range: "bytes=0-4" } })).status).toBe(206); // ranges go straight to the bucket
  });

  it("an expired link stops working", async () => {
    const url = await s.direct!.presignDownload("o/t/final.pdf", { contentType: "application/pdf", fileName: "x.pdf", inline: true, expiresSeconds: 1 });
    await new Promise((r) => setTimeout(r, 2200));
    expect((await fetch(url)).status).toBe(403);
  });
});


describe("configuration from environment", () => {
  const e = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  it("uses AWS_* variables and selects S3 automatically when a bucket is set", () => {
    expect(driverName(e({}))).toBe("local");
    expect(driverName(e({ STORAGE_DRIVER: "" }))).toBe("local"); // empty string = unset, as in .env.example
    expect(driverName(e({ S3_BUCKET: "b" }))).toBe("s3");
    expect(driverName(e({ AWS_S3_BUCKET: "b" }))).toBe("s3"); // alias
    expect(driverName(e({ S3_BUCKET: "b", STORAGE_DRIVER: "local" }))).toBe("local"); // explicit choice wins
    expect(() => driverName(e({ STORAGE_DRIVER: "ftp" }))).toThrow(/Unknown STORAGE_DRIVER/);
    expect(s3ConfigFromEnv(e({ S3_BUCKET: "bkt", AWS_REGION: "eu-west-1", AWS_ACCESS_KEY_ID: "AK", AWS_SECRET_ACCESS_KEY: "SK" })))
      .toMatchObject({ bucket: "bkt", region: "eu-west-1", accessKeyId: "AK", secretAccessKey: "SK", forcePathStyle: false });
  });
  it("accepts an IAM role (no keys) but not half a key pair, and still understands the legacy S3_* names", () => {
    expect(s3ConfigFromEnv(e({ S3_BUCKET: "b" }))).toMatchObject({ accessKeyId: undefined, secretAccessKey: undefined });
    expect(() => s3ConfigFromEnv(e({ S3_BUCKET: "b", AWS_ACCESS_KEY_ID: "AK" }))).toThrow(/both/);
    expect(() => s3ConfigFromEnv(e({}))).toThrow(/S3_BUCKET/);
    expect(s3ConfigFromEnv(e({ AWS_S3_BUCKET: "alias" })).bucket).toBe("alias");
    expect(s3ConfigFromEnv(e({ S3_BUCKET: "old", S3_REGION: "auto", S3_ENDPOINT: "https://r2" }))).toMatchObject({ bucket: "old", region: "auto", endpoint: "https://r2" });
  });
});
