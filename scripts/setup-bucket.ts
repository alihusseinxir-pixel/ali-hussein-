// One-time (idempotent) bucket preparation for direct browser uploads:
//   npm run storage:setup            apply CORS + lifecycle, then report
//   npm run storage:setup -- --check report only, change nothing
// Needs credentials with s3:PutBucketCORS / s3:PutLifecycleConfiguration (admin once, not the app's runtime user).
import { GetBucketCorsCommand, GetBucketLifecycleConfigurationCommand, GetPublicAccessBlockCommand, PutBucketCorsCommand, PutBucketLifecycleConfigurationCommand, S3Client } from "@aws-sdk/client-s3";
import { s3ConfigFromEnv } from "../src/lib/storage-s3";

async function main() {
  const check = process.argv.includes("--check");
  const c = s3ConfigFromEnv();
  const origin = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  if (!origin) throw new Error("Set APP_URL (the origin the browser uses, e.g. https://basma.example.com): it becomes the CORS allowed origin.");
  const client = new S3Client({
    region: c.region, endpoint: c.endpoint, forcePathStyle: c.forcePathStyle,
    credentials: c.accessKeyId && c.secretAccessKey ? { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } : undefined,
  });
  const note = (ok: boolean, msg: string) => console.log(`${ok ? "✔" : "✖"} ${msg}`);

  const cors = { CORSRules: [{ AllowedOrigins: [origin], AllowedMethods: ["PUT"], AllowedHeaders: ["Content-Type", "Content-Length"], MaxAgeSeconds: 3000 }] };
  if (!check) await client.send(new PutBucketCorsCommand({ Bucket: c.bucket, CORSConfiguration: cors }));
  const gotCors = await client.send(new GetBucketCorsCommand({ Bucket: c.bucket })).then((r) => r.CORSRules ?? [], () => []);
  note(gotCors.some((r) => r.AllowedOrigins?.includes(origin) && r.AllowedMethods?.includes("PUT")), `CORS allows PUT from ${origin}`);

  // Uploads wait in pending/ until the app has verified them; abandoned ones should not live forever.
  const rule = { ID: "expire-abandoned-uploads", Status: "Enabled" as const, Filter: { Prefix: `${c.prefix ? c.prefix.replace(/\/+$/, "") + "/" : ""}pending/` }, Expiration: { Days: 1 }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } };
  try {
    if (!check) await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket: c.bucket, LifecycleConfiguration: { Rules: [rule] } }));
    const lc = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: c.bucket })).then((r) => r.Rules ?? [], () => []);
    note(lc.some((r) => r.ID === rule.ID), "Lifecycle expires pending/ uploads after 1 day");
  } catch (e) {
    note(false, `Lifecycle rule not applied (${e instanceof Error ? e.message : e}). Add it by hand: expire prefix "${rule.Filter.Prefix}" after 1 day.`);
  }

  const pab = await client.send(new GetPublicAccessBlockCommand({ Bucket: c.bucket })).then((r) => r.PublicAccessBlockConfiguration, () => null);
  const blocked = !!(pab?.BlockPublicAcls && pab.BlockPublicPolicy && pab.IgnorePublicAcls && pab.RestrictPublicBuckets);
  note(blocked, blocked ? "Block Public Access is fully on (files are served only through signed links)" : "Block Public Access is NOT fully enabled — turn all four settings on in the S3 console. Files must never be public.");
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
