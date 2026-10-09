import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";
import type { Storage } from "./storage";

/** RFC 5987 encoding so Arabic / special-character file names survive Content-Disposition. */
const disposition = (inline: boolean, name: string) => `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

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
    direct: {
      async presignUpload(key, o) {
        // Type and exact length are part of the signature, so the URL cannot be used to upload anything else.
        const headers = { "Content-Type": o.contentType, "Content-Length": String(o.contentLength) };
        const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: c.bucket, Key: full(key), ContentType: o.contentType, ContentLength: o.contentLength }), {
          expiresIn: o.expiresSeconds, signableHeaders: new Set(["content-type", "content-length"]),
        });
        return { url, headers };
      },
      async presignDownload(key, o) {
        return getSignedUrl(client, new GetObjectCommand({
          Bucket: c.bucket, Key: full(key), ResponseContentType: o.contentType, ResponseContentDisposition: disposition(o.inline, o.fileName), ResponseCacheControl: "private, no-store",
        }), { expiresIn: o.expiresSeconds });
      },
      async move(from, to) {
        // CopySource must be URL-encoded "bucket/key"; keys here are generated ASCII, encoded defensively.
        await client.send(new CopyObjectCommand({ Bucket: c.bucket, Key: full(to), CopySource: `${c.bucket}/${full(from).split("/").map(encodeURIComponent).join("/")}` }));
        await client.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: full(from) }));
      },
    },
  };
}

/**
 * Credentials and location come from the environment only (never from code, never logged):
 *   S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 * Optional, for S3-compatible providers (Cloudflare R2, MinIO…): S3_ENDPOINT, S3_FORCE_PATH_STYLE; and S3_PREFIX for a folder in the bucket.
 * AWS_S3_BUCKET is accepted as an alias of S3_BUCKET; S3_REGION / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY as fallbacks.
 * Without keys the AWS SDK falls back to its default chain (IAM role / instance profile).
 */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config {
  const bucket = env.S3_BUCKET || env.AWS_S3_BUCKET;
  if (!bucket) throw new Error("S3 storage requires S3_BUCKET");
  const accessKeyId = env.AWS_ACCESS_KEY_ID || env.S3_ACCESS_KEY_ID || undefined;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY || env.S3_SECRET_ACCESS_KEY || undefined;
  if (!!accessKeyId !== !!secretAccessKey) throw new Error("Set both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (or neither, to use an IAM role)");
  return {
    bucket,
    region: env.AWS_REGION || env.S3_REGION || "us-east-1",
    endpoint: env.S3_ENDPOINT || undefined,
    accessKeyId, secretAccessKey,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    prefix: env.S3_PREFIX || undefined,
  };
}
