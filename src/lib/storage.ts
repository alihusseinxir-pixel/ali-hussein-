import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

/**
 * Storage abstraction. Only the local-disk driver is implemented; an S3-compatible driver
 * (put/get/remove with the same shape) can replace it without touching callers.
 */
export interface Storage {
  put(key: string, body: ReadableStream<Uint8Array>): Promise<void>;
  get(key: string, range?: { start: number; end: number }): Promise<Readable>;
  size(key: string): Promise<number>;
  remove(key: string): Promise<void>;
}

const root = () => path.resolve(process.env.STORAGE_DIR ?? "./uploads");

function resolveKey(key: string): string {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid storage key");
  return full;
}

export const storage: Storage = {
  async put(key, body) {
    const full = resolveKey(key);
    await mkdir(path.dirname(full), { recursive: true });
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), createWriteStream(full, { flags: "wx" }));
  },
  async get(key, range) {
    return createReadStream(resolveKey(key), range);
  },
  async size(key) {
    return (await stat(resolveKey(key))).size;
  },
  async remove(key) {
    await rm(resolveKey(key), { force: true });
  },
};
