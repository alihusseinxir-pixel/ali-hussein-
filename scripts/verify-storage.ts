// Live end-to-end check of your storage configuration. Run it LOCALLY after putting your values in .env:
//   npm run storage:verify
// It uses a throw-away object under healthcheck/, prints no credentials, and removes what it created.
import { randomUUID } from "node:crypto";
import { storage, driverName } from "../src/lib/storage";
import { describeError } from "../src/lib/log-safe";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function main() {
  let failures = 0;
  const step = async (label: string, fn: () => Promise<string | void>) => {
    try { const extra = await fn(); console.log(`✔ ${label}${extra ? ` — ${extra}` : ""}`); }
    catch (e) { failures++; console.log(`✖ ${label}: ${describeError(e)}`); }
  };
  console.log(`Storage driver: ${driverName()}`);
  const d = storage.direct;
  if (!d) { console.log("✖ This driver has no presigned URL support (local disk). Set S3_BUCKET to test S3."); process.exit(2); }

  const key = `healthcheck/${randomUUID()}.png`;
  const exp = 60;
  let putOk = false;
  await step("Presigned upload (PUT) works", async () => {
    const { url, headers } = await d.presignUpload(key, { contentType: "image/png", contentLength: PNG.length, expiresSeconds: exp });
    const r = await fetch(url, { method: "PUT", headers, body: new Uint8Array(PNG) });
    if (!r.ok) throw new Error(`HTTP ${r.status} (check credentials, bucket name, region, IAM policy)`);
    putOk = true;
  });
  await step("Uploaded object has the exact size", async () => { if (!putOk) throw new Error("skipped: upload failed"); const n = await storage.size(key); if (n !== PNG.length) throw new Error(`size ${n} ≠ ${PNG.length}`); });
  let url = "";
  await step("Presigned download (GET) returns the same bytes, with our type and disposition", async () => {
    if (!putOk) throw new Error("skipped: upload failed");
    url = await d.presignDownload(key, { contentType: "image/png", fileName: "check.png", inline: false, expiresSeconds: exp });
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!Buffer.from(await r.arrayBuffer()).equals(PNG)) throw new Error("content differs");
    return `${r.headers.get("content-type")}; ${r.headers.get("content-disposition")}`;
  });
  await step("Range requests work (video seeking)", async () => {
    if (!url) throw new Error("skipped");
    const r = await fetch(url, { headers: { Range: "bytes=0-3" } });
    if (r.status !== 206) throw new Error(`expected HTTP 206, got ${r.status}`);
  });
  await step("The object is NOT public (an unsigned request is refused)", async () => {
    if (!url) throw new Error("skipped");
    const bare = url.split("?")[0];
    const r = await fetch(bare);
    if (r.ok) throw new Error(`PUBLIC! an unauthenticated GET returned HTTP ${r.status}. Run: npm run storage:setup`);
    return `HTTP ${r.status}`;
  });
  await step("Tampered signature is refused", async () => {
    if (!url) throw new Error("skipped");
    const r = await fetch(url.replace(/X-Amz-Signature=[0-9a-f]+/, "X-Amz-Signature=" + "0".repeat(64)));
    if (r.ok) throw new Error("a forged signature was accepted");
    return `HTTP ${r.status}`;
  });
  await step("Move (copy + delete) works", async () => {
    if (!putOk) throw new Error("skipped");
    await d.move(key, `${key}.moved`);
    await storage.size(`${key}.moved`);
    await storage.remove(`${key}.moved`);
  });
  await step("Cleanup", async () => { await storage.remove(key); });

  console.log(failures === 0 ? "\nStorage is configured correctly." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 2);
}
main().catch((e) => { console.error(describeError(e)); process.exit(1); });
