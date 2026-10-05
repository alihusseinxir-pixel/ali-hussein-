// One-time (idempotent) bucket hardening for direct browser uploads. Run it LOCALLY with your own credentials in .env:
//   npm run storage:setup            apply, then verify and report
//   npm run storage:setup -- --check report only, change nothing
// Needs an ADMIN credential (s3:PutBucketPublicAccessBlock, PutBucketCORS, PutLifecycleConfiguration,
// PutBucketOwnershipControls). Do NOT give those permissions to the app's runtime credentials.
import {
  GetBucketCorsCommand, GetBucketLifecycleConfigurationCommand, GetBucketOwnershipControlsCommand, GetBucketPolicyStatusCommand, GetPublicAccessBlockCommand,
  PutBucketCorsCommand, PutBucketLifecycleConfigurationCommand, PutBucketOwnershipControlsCommand, PutPublicAccessBlockCommand, S3Client,
} from "@aws-sdk/client-s3";
import { s3ConfigFromEnv } from "../src/lib/storage-s3";
import { describeError } from "../src/lib/log-safe";

async function main() {
  const check = process.argv.includes("--check");
  const c = s3ConfigFromEnv();
  const origin = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  if (!origin) throw new Error("Set APP_URL (the origin the browser uses, e.g. https://basma.example.com): it becomes the CORS allowed origin.");
  const client = new S3Client({
    region: c.region, endpoint: c.endpoint, forcePathStyle: c.forcePathStyle,
    credentials: c.accessKeyId && c.secretAccessKey ? { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } : undefined,
  });
  let failures = 0;
  const note = (ok: boolean, msg: string) => { if (!ok) failures++; console.log(`${ok ? "✔" : "✖"} ${msg}`); };
  const attempt = async (what: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { note(false, `${what}: ${describeError(e)}`); } };
  console.log(`Bucket "${c.bucket}" (${c.region})${check ? " — check only, nothing is changed" : ""}`);

  // 1) Block Public Access — all four switches. This is the main guarantee that no file can ever become public.
  if (!check) await attempt("Could not enable Block Public Access", async () => {
    await client.send(new PutPublicAccessBlockCommand({ Bucket: c.bucket, PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } }));
  });
  const pab = await client.send(new GetPublicAccessBlockCommand({ Bucket: c.bucket })).then((r) => r.PublicAccessBlockConfiguration, () => null);
  note(!!(pab?.BlockPublicAcls && pab.IgnorePublicAcls && pab.BlockPublicPolicy && pab.RestrictPublicBuckets), "Block Public Access is fully ON (all 4 settings)");

  // 2) Disable ACLs: every object is owned by the bucket owner, so a per-object "public-read" ACL cannot exist.
  if (!check) await attempt("Could not disable ACLs", async () => {
    await client.send(new PutBucketOwnershipControlsCommand({ Bucket: c.bucket, OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] } }));
  });
  const own = await client.send(new GetBucketOwnershipControlsCommand({ Bucket: c.bucket })).then((r) => r.OwnershipControls?.Rules?.[0]?.ObjectOwnership, () => undefined);
  note(own === "BucketOwnerEnforced", "ACLs are disabled (Object Ownership = Bucket owner enforced)");

  // 3) The bucket policy (if any) must not make the bucket public.
  const status = await client.send(new GetBucketPolicyStatusCommand({ Bucket: c.bucket })).then((r) => r.PolicyStatus?.IsPublic, (e) => (e?.name === "NoSuchBucketPolicy" ? false : undefined));
  note(status === false, status === undefined ? "Could not determine whether the bucket policy is public (needs s3:GetBucketPolicyStatus)" : "Bucket policy does not make the bucket public");

  // 4) CORS: browsers may PUT to presigned URLs, from this app's origin only.
  const cors = { CORSRules: [{ AllowedOrigins: [origin], AllowedMethods: ["PUT"], AllowedHeaders: ["Content-Type", "Content-Length"], MaxAgeSeconds: 3000 }] };
  if (!check) await attempt("Could not apply CORS", async () => { await client.send(new PutBucketCorsCommand({ Bucket: c.bucket, CORSConfiguration: cors })); });
  const gotCors = await client.send(new GetBucketCorsCommand({ Bucket: c.bucket })).then((r) => r.CORSRules ?? [], () => []);
  note(gotCors.some((r) => r.AllowedOrigins?.includes(origin) && r.AllowedMethods?.includes("PUT")) && gotCors.every((r) => !r.AllowedOrigins?.includes("*")), `CORS allows PUT from ${origin} only`);

  // 5) Uploads wait in pending/ until the app has verified them; abandoned ones expire.
  const rule = { ID: "expire-abandoned-uploads", Status: "Enabled" as const, Filter: { Prefix: `${c.prefix ? c.prefix.replace(/\/+$/, "") + "/" : ""}pending/` }, Expiration: { Days: 1 }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } };
  if (!check) await attempt(`Lifecycle rule not applied (add it by hand: expire prefix "${rule.Filter.Prefix}" after 1 day)`, async () => {
    await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket: c.bucket, LifecycleConfiguration: { Rules: [rule] } }));
  });
  const lc = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: c.bucket })).then((r) => r.Rules ?? [], () => []);
  note(lc.some((r) => r.ID === rule.ID), "Lifecycle expires abandoned pending/ uploads after 1 day");

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) need attention (see ✖ above).`);
  process.exit(failures === 0 ? 0 : 2);
}
main().catch((e) => { console.error(describeError(e)); process.exit(1); });
