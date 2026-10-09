import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import S3rver from "s3rver";
import { createLocalStorage } from "./storage-local";
import { createS3Storage, s3ConfigFromEnv } from "./storage-s3";
import type { Storage } from "./storage";

const toWeb = (b: Buffer) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(b)); c.close(); } });
const chunked = (b: Buffer, n = 64 * 1024) => new ReadableStream<Uint8Array>({
  start(c) { for (let i = 0; i < b.length; i += n) c.enqueue(new Uint8Array(b.subarray(i, i + n))); c.close(); },
});
const read = async (s: Readable) => { const parts: Buffer[] = []; for await (const p of s) parts.push(Buffer.from(p)); return Buffer.concat(parts); };

/** The same behavioural contract must hold for every driver. */
function contract(name: string, make: () => Storage) {
  describe(`${name} driver`, () => {
    let s: Storage;
    beforeAll(() => { s = make(); });
    const key = (n: string) => `org1/task1/${Date.now()}-${n}.bin`;

    it("stores and reads back bytes exactly", async () => {
      const k = key("a"), data = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
      await s.put(k, toWeb(data));
      expect(await s.size(k)).toBe(5000);
      expect((await read(await s.get(k))).equals(data)).toBe(true);
    });

    it("streams a multi-megabyte object without corruption", async () => {
      const k = key("big"), data = Buffer.alloc(9 * 1024 * 1024 + 123, 7);
      data.writeUInt32BE(0xdeadbeef, 0); data.writeUInt32BE(0xcafebabe, data.length - 4);
      await s.put(k, chunked(data));
      expect(await s.size(k)).toBe(data.length);
      const back = await read(await s.get(k));
      expect(back.length).toBe(data.length);
      expect(back.equals(data)).toBe(true);
    }, 30_000);

    it("serves byte ranges (inclusive, like HTTP)", async () => {
      const k = key("range"), data = Buffer.from("0123456789abcdefghij");
      await s.put(k, toWeb(data));
      expect((await read(await s.get(k, { start: 0, end: 4 }))).toString()).toBe("01234");
      expect((await read(await s.get(k, { start: 10, end: 19 }))).toString()).toBe("abcdefghij");
      expect((await read(await s.get(k, { start: 5, end: 5 }))).toString()).toBe("5");
    });

    it("reports a missing object by throwing, and delete is idempotent", async () => {
      const k = key("gone");
      await expect(s.size(k)).rejects.toThrow();
      await expect(s.get(k)).rejects.toThrow();
      await s.put(k, toWeb(Buffer.from("x")));
      await s.remove(k);
      await expect(s.size(k)).rejects.toThrow();
      await expect(s.remove(k)).resolves.toBeUndefined(); // second delete must not fail
    });

    it("rejects path traversal keys", async () => {
      await expect(s.put("../escape.bin", toWeb(Buffer.from("x")))).rejects.toThrow(/Invalid storage key/);
      await expect(s.size("/etc/passwd")).rejects.toThrow();
    });
  });
}

const dir = mkdtempSync(path.join(tmpdir(), "basma-storage-"));
contract("local", () => createLocalStorage(path.join(dir, "local")));

describe("S3 config", () => {
  it("requires a bucket and reads optional settings", () => {
    expect(() => s3ConfigFromEnv({} as NodeJS.ProcessEnv)).toThrow(/S3_BUCKET/);
    expect(s3ConfigFromEnv({ S3_BUCKET: "b", S3_ENDPOINT: "https://x.r2.cloudflarestorage.com", S3_REGION: "auto", S3_FORCE_PATH_STYLE: "true", S3_PREFIX: "prod" } as unknown as NodeJS.ProcessEnv))
      .toMatchObject({ bucket: "b", region: "auto", endpoint: "https://x.r2.cloudflarestorage.com", forcePathStyle: true, prefix: "prod" });
    expect(s3ConfigFromEnv({ S3_BUCKET: "b" } as unknown as NodeJS.ProcessEnv)).toMatchObject({ region: "us-east-1", forcePathStyle: false });
  });
});

// Real S3 protocol against an in-process S3-compatible server (s3rver), no mocks of the SDK.
let server: S3rver;
let port = 0;
beforeAll(async () => {
  server = new S3rver({ port: 0, address: "127.0.0.1", silent: true, directory: path.join(dir, "s3"), configureBuckets: [{ name: "basma-test", configs: [] }] });
  const addr = await server.run();
  port = typeof addr === "object" && addr ? (addr as { port: number }).port : 0;
});
afterAll(async () => { await server?.close(); rmSync(dir, { recursive: true, force: true }); });

contract("s3 (S3-compatible server)", () => createS3Storage({
  bucket: "basma-test", region: "us-east-1", endpoint: `http://127.0.0.1:${port}`, forcePathStyle: true,
  accessKeyId: "S3RVER", secretAccessKey: "S3RVER", prefix: "uploads",
}));
