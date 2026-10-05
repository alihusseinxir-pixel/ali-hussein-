// Copy files that live on local disk (STORAGE_DIR) into the configured S3 bucket.
//   STORAGE_DRIVER=s3 S3_BUCKET=... npm run storage:migrate [-- --dry-run]
// Safe to re-run: objects that already exist in the bucket are skipped. Local files are never deleted.
import { createReadStream } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { createLocalStorage } from "../src/lib/storage-local";
import { createS3Storage, s3ConfigFromEnv } from "../src/lib/storage-s3";
import { Readable } from "node:stream";

async function main() {
  const dry = process.argv.includes("--dry-run");
  const local = createLocalStorage(process.env.STORAGE_DIR ?? "./uploads");
  const s3 = createS3Storage(s3ConfigFromEnv());
  const db = new PrismaClient();
  const rows = await db.taskAttachment.findMany({ select: { id: true, fileUrl: true } }); // includes soft-deleted: history must stay readable
  let copied = 0, skipped = 0, missing = 0;
  for (const r of rows) {
    if (await s3.size(r.fileUrl).then(() => true, () => false)) { skipped++; continue; }
    if (!(await local.size(r.fileUrl).then(() => true, () => false))) { console.warn(`missing locally: ${r.fileUrl}`); missing++; continue; }
    if (!dry) await s3.put(r.fileUrl, Readable.toWeb(createReadStream(`${process.env.STORAGE_DIR ?? "./uploads"}/${r.fileUrl}`)) as ReadableStream<Uint8Array>);
    copied++;
  }
  console.log(JSON.stringify({ dryRun: dry, total: rows.length, copied, skipped, missingLocally: missing }));
  await db.$disconnect();
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
