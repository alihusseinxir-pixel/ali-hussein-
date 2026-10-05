import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { Storage } from "./storage";

export function createLocalStorage(dir: string): Storage {
  const root = path.resolve(dir);
  const resolveKey = (key: string) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return full;
  };
  return {
    async put(key, body) {
      const full = resolveKey(key);
      await mkdir(path.dirname(full), { recursive: true });
      await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), createWriteStream(full, { flags: "wx" }));
    },
    async get(key, range) {
      const full = resolveKey(key);
      await stat(full); // reject now for a missing file, like other drivers, instead of failing later on the stream
      return createReadStream(full, range);
    },
    async size(key) {
      return (await stat(resolveKey(key))).size;
    },
    async remove(key) {
      await rm(resolveKey(key), { force: true });
    },
  };
}
