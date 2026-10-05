import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";
import type { Storage } from "./storage";

export interface S3Config {
  bucket: string;
  region: string;
  endpoint?: string; // R2 / MinIO / any S3-compatible service; omit for AWS
  accessKeyId?: string; // omit to use the SDK's default credential chain (IAM role, env, profile…)
  secretAccessKey?: string;
  forcePathStyle?: boolean; // required by MinIO and some self-hosted services
  prefix?: string; // optional folder inside the bucket
}

/** S3-compatible driver: streaming multipart uploads, ranged reads, HEAD for size, idempotent delete. */
export function createS3Storage(c: S3Config): Storage {
  const client = new S3Client({
    region: c.region,
    endpoint: c.endpoint,
    forcePathStyle: c.forcePathStyle,
    credentials: c.accessKeyId && c.secretAccessKey ? { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } : undefined,
    // Some S3-compatible services reject the SDK's newer default checksums; only send them when required.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const full = (key: string) => {
    if (key.includes("..") || key.startsWith("/")) throw new Error("Invalid storage key");
    return c.prefix ? `${c.prefix.replace(/\/+$/, "")}/${key}` : key;
  };
  return {
    async put(key, body) {
      const upload = new Upload({
        client, queueSize: 3, partSize: 8 * 1024 * 1024, leavePartsOnError: false,
        params: { Bucket: c.bucket, Key: full(key), Body: Readable.fromWeb(body as import("node:stream/web").ReadableStream) },
      });
      await upload.done();
    },
    async get(key, range) {
      const r = await client.send(new GetObjectCommand({ Bucket: c.bucket, Key: full(key), Range: range ? `bytes=${range.start}-${range.end}` : undefined }));
      if (!r.Body) throw new Error("Empty object body");
      return r.Body as Readable;
    },
    async size(key) {
      const r = await client.send(new HeadObjectCommand({ Bucket: c.bucket, Key: full(key) }));
      return r.ContentLength ?? 0;
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: full(key) })); // S3 delete is already idempotent
    },
  };
}

export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config {
  if (!env.S3_BUCKET) throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET");
  return {
    bucket: env.S3_BUCKET,
    region: env.S3_REGION || "us-east-1",
    endpoint: env.S3_ENDPOINT || undefined,
    accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    prefix: env.S3_PREFIX || undefined,
  };
}
