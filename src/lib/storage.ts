import "server-only";
import type { Readable } from "node:stream";
import { createLocalStorage } from "./storage-local";
import { createS3Storage, s3ConfigFromEnv } from "./storage-s3";

/**
 * Storage abstraction used for every uploaded file. Callers only ever see this interface;
 * `STORAGE_DRIVER` picks the backend:
 *   local (default)  files under STORAGE_DIR
 *   s3               any S3-compatible service (AWS S3, Cloudflare R2, MinIO, …) — see .env.example
 * Files are always served through the app (/api/files/:id), which re-checks permissions, so a bucket can stay private.
 */
export interface Storage {
  put(key: string, body: ReadableStream<Uint8Array>): Promise<void>;
  get(key: string, range?: { start: number; end: number }): Promise<Readable>;
  size(key: string): Promise<number>; // throws when the object does not exist
  remove(key: string): Promise<void>;
}

let driver: Storage | undefined;
function current(): Storage {
  if (!driver) {
    const name = process.env.STORAGE_DRIVER ?? "local";
    if (name === "s3") driver = createS3Storage(s3ConfigFromEnv());
    else if (name === "local") driver = createLocalStorage(process.env.STORAGE_DIR ?? "./uploads");
    else throw new Error(`Unknown STORAGE_DRIVER "${name}" (use "local" or "s3")`);
  }
  return driver;
}

export const storage: Storage = {
  put: (k, b) => current().put(k, b),
  get: (k, r) => current().get(k, r),
  size: (k) => current().size(k),
  remove: (k) => current().remove(k),
};
