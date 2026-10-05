import "server-only";
import type { Readable } from "node:stream";
import { createLocalStorage } from "./storage-local";
import { createS3Storage, s3ConfigFromEnv } from "./storage-s3";

/**
 * Storage abstraction used for every uploaded file. Business code only ever sees this interface.
 *
 * Drivers (STORAGE_DRIVER; defaults to "s3" when AWS_S3_BUCKET is set, otherwise "local"):
 *   local  files under STORAGE_DIR; all bytes pass through the app
 *   s3     AWS S3, or any S3-compatible service (Cloudflare R2, MinIO…) via S3_ENDPOINT
 *
 * A driver MAY also offer `direct` access (presigned URLs): the browser then uploads/downloads straight
 * to/from the bucket, while the app still authorises every request and validates every upload.
 */
export interface Storage {
  put(key: string, body: ReadableStream<Uint8Array>): Promise<void>;
  get(key: string, range?: { start: number; end: number }): Promise<Readable>;
  size(key: string): Promise<number>; // throws when the object does not exist
  remove(key: string): Promise<void>;
  direct?: DirectStorage;
}

export interface DirectStorage {
  /** Short-lived URL the browser can PUT the file to. Headers must be sent exactly as returned. */
  presignUpload(key: string, o: { contentType: string; contentLength: number; expiresSeconds: number }): Promise<{ url: string; headers: Record<string, string> }>;
  /** Short-lived URL that serves the object with the given type/disposition. */
  presignDownload(key: string, o: { contentType: string; fileName: string; inline: boolean; expiresSeconds: number }): Promise<string>;
  /** Server-side rename (copy + delete) inside the bucket. */
  move(from: string, to: string): Promise<void>;
}

let driver: Storage | undefined;
export function driverName(env: NodeJS.ProcessEnv = process.env): "local" | "s3" {
  const n = env.STORAGE_DRIVER || (env.AWS_S3_BUCKET || env.S3_BUCKET ? "s3" : "local"); // empty string counts as unset (as in .env.example)
  if (n !== "local" && n !== "s3") throw new Error(`Unknown STORAGE_DRIVER "${n}" (use "local" or "s3")`);
  return n;
}

function current(): Storage {
  if (!driver) {
    if (driverName() === "s3") driver = createS3Storage(s3ConfigFromEnv());
    else {
      if (process.env.NODE_ENV === "production") console.warn("[storage] Using LOCAL disk in production. Files are lost on ephemeral hosts; set AWS_S3_BUCKET to use S3.");
      driver = createLocalStorage(process.env.STORAGE_DIR ?? "./uploads");
    }
  }
  return driver;
}

export const storage: Storage = {
  put: (k, b) => current().put(k, b),
  get: (k, r) => current().get(k, r),
  size: (k) => current().size(k),
  remove: (k) => current().remove(k),
  get direct() { return current().direct; },
};

export const PRESIGN_TTL_SECONDS = Math.min(900, Math.max(30, Number(process.env.PRESIGN_TTL_SECONDS) || 300));
