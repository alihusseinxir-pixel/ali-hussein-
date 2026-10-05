# File storage (AWS S3)

BASMA stores uploaded files through one abstraction (`src/lib/storage.ts`). Business code never mentions S3.
Set the four variables below and files go to S3; remove them and it falls back to local disk (development).

```bash
AWS_S3_BUCKET=your-bucket
AWS_REGION=eu-central-1
AWS_ACCESS_KEY_ID=...        # omit both keys to use an IAM role / instance profile
AWS_SECRET_ACCESS_KEY=...
APP_URL=https://basma.example.com   # also used for the CORS allowed origin
```

Credentials are read **only from the environment**. `.env` is git-ignored; use your host's secret manager in production.

## How files move

| Step | Who | What |
|---|---|---|
| Upload 1 | browser → app | `POST /api/tasks/:id/files/init` — the app checks the person may upload, the file type/extension/kind and size, then returns a **presigned PUT URL** (default 5 min) for a quarantined key `pending/<org>/<task>/<uuid>.<ext>`. Content-Type and exact length are part of the signature. |
| Upload 2 | browser → S3 | The browser PUTs the file straight to the bucket (the app server never carries the bytes). |
| Upload 3 | browser → app | `POST /api/tasks/:id/files/complete` — the app re-checks permissions, **verifies what actually arrived** (exact size, real file type from the first bytes), moves it to `<org>/<task>/<uuid>.<ext>` and records version/activity. Anything wrong is deleted from `pending/` and rejected. |
| Download | browser → app → S3 | `GET /api/files/:id` checks task visibility on **every request**, then answers `302` to a presigned GET URL (default 5 min) whose content type and `Content-Disposition` come from the app's whitelist, not from the object. Range requests (video seeking) go straight to S3. |

The bucket is **private**; there are no public URLs. A signed link only exists for a few minutes after a permission check, and can be used by whoever holds it during that time (like any presigned URL). Tune with `PRESIGN_TTL_SECONDS` (30–900).

With the local driver there are no presigned URLs: uploads and downloads stream through the app instead (same checks, same validation).

## One-time bucket setup

1. Create a **private** bucket and turn on all four *Block Public Access* settings.
2. Create an IAM user/role for the app with only this policy (replace the bucket name):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::your-bucket/*" }
     ]
   }
   ```
   (No `ListBucket`, no bucket-level permissions: the app never lists or administers the bucket.)
3. Apply CORS (so browsers may PUT) and the cleanup rule for abandoned uploads, once, with an admin credential:
   ```bash
   npm run storage:setup            # applies CORS for APP_URL + expires pending/ after 1 day, then reports
   npm run storage:setup -- --check # report only
   ```
   Equivalent CORS rule if you prefer the console: allowed origin = your `APP_URL`, method `PUT`, headers `Content-Type, Content-Length`.
4. Existing files on local disk? `npm run storage:migrate -- --dry-run`, then `npm run storage:migrate` (idempotent, never deletes the local copies).

## Switching to Cloudflare R2 or another S3-compatible provider

No code changes. Use the provider's keys in the same `AWS_*` variables and add `S3_ENDPOINT` (and `AWS_REGION=auto` for R2, `S3_FORCE_PATH_STYLE=true` for MinIO). Presigned URLs, ranges, copy and delete are all standard S3 API calls. Another storage technology would only need a new driver implementing the `Storage` interface.

## What is verified, and what is not

Verified in automated tests against a real S3-protocol server (`s3rver`) and the real database: the driver contract (streaming, ranges, missing objects, idempotent delete, path traversal), presigned PUT/GET, copy/move, expiry, the full init → PUT → complete protocol including every rejection path (wrong type, wrong size, not uploaded, replay, other user's/forged/expired token, other organization), and a full browser run.
**Not verified against real AWS**: signature enforcement of Content-Type/Content-Length by S3 itself (the emulator ignores it; the app independently re-verifies size and file type after upload), your real CORS/IAM configuration, and S3 latency. Do one real upload/download after configuring the bucket.
