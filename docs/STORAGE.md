# File storage on AWS S3 — setup guide

BASMA stores every uploaded file (raw footage, finals, references, comment attachments) through one abstraction
(`src/lib/storage.ts`). Business code never mentions S3. With the variables below set, files go to a **private** S3 bucket;
without them, files go to local disk (development only).

> **Secrets rule.** Credentials live **only** in a local `.env` file (git-ignored) or your host's secret manager.
> Nothing in this repository contains a credential, `.env.example` lists variable *names* with empty values, and
> automated tests fail the build if a secret-looking value or a tracked `.env` appears. Never paste credentials into chat,
> issues, pull requests or commit messages.

## 1. What you need to set (in your local `.env`)

```bash
S3_BUCKET=                 # the bucket name
AWS_REGION=                # e.g. eu-central-1
AWS_ACCESS_KEY_ID=         # of the app's IAM user (step 3)  — or leave BOTH keys empty to use an IAM role
AWS_SECRET_ACCESS_KEY=
APP_URL=https://your-app-origin     # becomes the CORS allowed origin
```

`cp .env.example .env`, then fill these in. Optional: `PRESIGN_TTL_SECONDS` (30–900, default 300), `MAX_UPLOAD_MB` (default 100).
Setting `S3_BUCKET` switches the app to S3 automatically. Set **both** keys or **neither** (the app refuses half a pair).

## 2. Create the bucket (private, no public access)

AWS console → S3 → *Create bucket*:
- **Block all public access: ON** (all four checkboxes).
- **Object Ownership: Bucket owner enforced** (ACLs disabled).
- Default encryption: SSE-S3 (the default) is fine.
- Versioning: optional.

Or with the AWS CLI (run with *your own* credentials, outside this project):
```bash
aws s3api create-bucket --bucket YOUR_BUCKET --region YOUR_REGION \
  --create-bucket-configuration LocationConstraint=YOUR_REGION   # omit this line for us-east-1
aws s3api put-public-access-block --bucket YOUR_BUCKET --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-ownership-controls --bucket YOUR_BUCKET --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
```

## 3. Create a least-privilege IAM user (or role) for the app

Policy (replace the bucket name). **Object permissions only** — no list, no bucket administration:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::YOUR_BUCKET/*" }
  ]
}
```
Create an access key for this user and put it in your local `.env`. On EC2/ECS/Lambda prefer an IAM role and leave the keys empty.

## 4. Apply the rest of the hardening, then verify

These two scripts run **locally with your own `.env`**; they print results, never credential values.

```bash
npm run storage:setup -- --check   # read-only report
npm run storage:setup              # applies Block Public Access, disables ACLs, CORS for APP_URL only, 1-day expiry of abandoned pending/ uploads
npm run storage:verify             # live test: presigned upload/download, ranges, "an unsigned request is refused", forged signature refused
```
`storage:setup` needs an **admin** credential for the bucket (it changes bucket settings); use your admin profile for this one command,
not the app's runtime key. `storage:verify` uses the app's normal permissions. Every line must show ✔.
If you prefer the console for CORS: allowed origin = your `APP_URL` (never `*`), method `PUT`, headers `Content-Type, Content-Length`.

## 5. Move existing local files (only if you already uploaded some)

```bash
npm run storage:migrate -- --dry-run   # what would be copied
npm run storage:migrate                # copy local files into the bucket (idempotent; local copies are never deleted)
```

## How it works (security model)

| Step | What happens |
|---|---|
| Upload 1 | `POST /api/tasks/:id/files/init` — the app checks the person may upload, **extension must be one of PDF, JPG, PNG, MP4, MOV, DOCX, XLSX**, **size ≤ `MAX_UPLOAD_MB`**, then returns a **presigned PUT URL** for a quarantined key `pending/<org>/<task>/<uuid>.<ext>`. The URL signs the content type and exact length, and expires in 5 minutes. |
| Upload 2 | The browser uploads **directly to S3**; the app server never carries the bytes. |
| Upload 3 | `POST /api/tasks/:id/files/complete` — the app re-checks permissions and **verifies what actually arrived**: exact size, and the **real file type from the first bytes** (a `.png` that is really an `.exe` is deleted and rejected). Only then is it moved out of `pending/` and recorded (version, activity log). |
| Download | `GET /api/files/:id` checks that the person may see the task **on every request**, then answers `302` to a presigned GET URL (5 minutes). Its content type and `Content-Disposition` come from the app's whitelist, not from the object. Video range requests go straight to S3. |

Guarantees:
- **No public files.** Block Public Access is on, ACLs are disabled, the app never sets an ACL, and no URL is permanent. A signed link works for minutes after a permission check and can be used by whoever holds it during that time (as with any presigned URL).
- **No credentials in code or logs.** Variables are read from the environment only. Errors are logged through `src/lib/log-safe.ts` (name, message, HTTP status — never the raw SDK error), which also redacts AWS key ids, `X-Amz-Signature/Credential` parts, `user:password@` URLs, bearer tokens and the values of secret-named environment variables. In production the mailer does not print email bodies (they contain single-use links).
- **Untrusted uploads are quarantined**: nothing is visible to anyone until it has passed type and size verification.

## Switching to Cloudflare R2 or another S3-compatible provider

No code changes. Use the provider's keys in the same variables and add `S3_ENDPOINT` (and `AWS_REGION=auto` for R2,
`S3_FORCE_PATH_STYLE=true` for MinIO). Another storage technology only needs a new driver implementing the `Storage` interface.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Upload fails in the browser with "Could not reach the file storage" | CORS missing/wrong origin: run `npm run storage:setup`, and make sure `APP_URL` is exactly the address in the browser bar (scheme + host + port). |
| `403` on upload or "expired" | The 5-minute link expired (retry), the IAM policy lacks `s3:PutObject`, or the server clock is far off. |
| `Access Denied` on download | IAM policy lacks `s3:GetObject`, or wrong region/bucket. |
| `S3 storage requires S3_BUCKET` / "Set both … AWS_SECRET_ACCESS_KEY" | Missing or half-set variables. |
| Files vanish after a redeploy | The app is still on the local driver (no `S3_BUCKET`) on an ephemeral disk. |

## What is verified, and what is not

Verified by automated tests against a real S3-protocol server (`s3rver`) and the real database: the driver contract (streaming, ranges,
missing objects, idempotent delete, path traversal), presigned PUT/GET, copy/move, expiry, the full init → PUT → complete protocol including every
rejection path, the secret-redaction rules, and the repository secret-hygiene rules; plus a full browser run (direct upload with CORS, preview, download,
permissions, comment attachments).
**Not verified against real AWS** (no credentials were used or shared): that S3 itself enforces the signed content type/length, Block Public Access and
ACL settings, your IAM policy, CORS and lifecycle on your bucket, and latency. `npm run storage:verify` and `npm run storage:setup -- --check` test exactly
these on your real bucket in a few seconds — run them once before going live.
