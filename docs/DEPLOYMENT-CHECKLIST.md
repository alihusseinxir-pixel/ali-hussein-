# Deployment checklist — Render

Tick each box in order. Nothing here is done for you: no deployment and no AWS resource has been created.
Variable details: [ENVIRONMENT.md](ENVIRONMENT.md). Step-by-step Render screens: [DEPLOY-RENDER.md](DEPLOY-RENDER.md). S3 details: [STORAGE.md](STORAGE.md).

**Never paste AWS keys, `SMTP_URL`, or `DATABASE_URL` into chat, GitHub, issues or code.** They go only in Render's dashboard (and a local git-ignored `.env`).

## 0. Decisions before you start
- [ ] PR #1 reviewed and merged **by you** (or choose the branch Render should deploy: `render.yaml` deploys whichever branch Render is pointed at).
- [ ] Public address: Render's `*.onrender.com` or your own domain → this is `APP_URL` (no trailing slash).
- [ ] AWS region code (e.g. `eu-central-1` or `me-central-1`; "Kirkuk" is not a region).
- [ ] Bucket name: lowercase letters, digits, hyphens, 3–63 chars, no spaces, avoid dots (e.g. `basma-marketing-prod-files`).
- [ ] Email is **optional**. Without `SMTP_URL`, the Team page shows invitation and password-reset links for you to send yourself (WhatsApp, etc.), and notifications stay inside the app. Add `SMTP_URL` + `MAIL_FROM` later if you want automatic emails.
- [ ] Accept: web `starter`, database `basic-256mb`, cron `starter` (paid; plan names/prices not validated on Render from here, confirm in the dashboard).

## 1. AWS (you do this in the AWS console; see STORAGE.md)
- [ ] Create a **private** S3 bucket in the chosen region: Block Public Access **ON** (all four), Object Ownership **Bucket owner enforced**, default encryption **SSE-S3**.
- [ ] Create a dedicated **production** IAM user (programmatic access only). No AdministratorAccess, no AmazonS3FullAccess. Attach the minimal policy from STORAGE.md scoped to this bucket only (`s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload` on `arn:aws:s3:::BUCKET/*`; add `s3:ListBucket` on the bucket only if STORAGE.md says so).
- [ ] Create an access key for that user; keep it **only** in Render (step 3). Never in chat or Git.
- [ ] Separate, smaller IAM user for setup (`PutBucketCors`, `PutBucketPublicAccessBlock`, `PutBucketOwnershipControls`, `PutLifecycleConfiguration`, `Get*` for the same) used once from your machine, then deactivated.
- [ ] Locally, with a git-ignored `.env` (S3 vars, `APP_URL` = production address), run:
  ```bash
  npx tsx --env-file=.env --conditions=react-server scripts/setup-bucket.ts --check   # read-only
  npx tsx --env-file=.env --conditions=react-server scripts/setup-bucket.ts           # apply CORS / lifecycle / block public access
  npx tsx --env-file=.env --conditions=react-server scripts/verify-storage.ts         # live presign checks
  ```
  Expect every line ✔ (the emulator-only ✖ lines must not appear against real AWS).
  Note: `npm run storage:*` do **not** auto-load `.env`; use the `tsx --env-file` form above.

## 2. Mail
- [ ] Verify the sender domain at the provider (SPF/DKIM).
- [ ] Optional: only if you want automatic email, have ready `SMTP_URL` (`smtps://USER:PASSWORD@host:465`) and `MAIL_FROM`. Otherwise skip this section.

## 3. Render
- [ ] Render → New → **Blueprint** → connect the repo/branch → it reads `render.yaml`.
- [ ] Enter the prompted values (web): `APP_URL`, `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
- [ ] Enter on the cron job: `APP_URL` (same value).
- [ ] Apply. First deploy runs `npm ci && npm run build`, then `prisma migrate deploy` at start. Wait until the health check is green.
- [ ] Confirm `https://<APP_URL>/api/health` returns `{"status":"ok"}`.
- [ ] Do **not** run the demo seed (it creates accounts with a known password).

## 4. Post-deploy verification
- [ ] Open `/register`, create **your** organization (this makes you Admin).
- [ ] **Immediately** set `ALLOW_SIGNUP=false` in Render and redeploy; confirm `/register` refuses.
- [ ] Log in, log out; wrong password shows the generic error.
- [ ] Team → invite a test member → copy the link shown (or the email, if SMTP is set) → it works once → a second visit says invalid.
- [ ] Team → "Password reset link" for a test member → the link works once. (With SMTP set, the Forgot-password email also works.)
- [ ] Create a brand, a campaign, a task; walk it through a handover.
- [ ] Upload a file to a task: it goes straight to S3 (browser network tab shows a PUT to `s3.<region>.amazonaws.com`), then downloads via a redirect to a short-lived signed URL.
- [ ] Open the object URL **without** the signature → `AccessDenied` (files are not public).
- [ ] Generate the brief PDF (Arabic text renders).
- [ ] Cron job `basma-reminders` runs (Render → Cron → Logs); a reminder / digest is created.
- [ ] Render logs contain no keys or passwords.

## 5. Go-live and operations
- [ ] Custom domain + TLS in Render, then update `APP_URL` (web **and** cron) and re-run `setup-bucket.ts` so CORS allows the new origin.
- [ ] Keep **one** web instance (login rate-limit is in-memory per instance).
- [ ] Enable Render database backups and test a restore: see [BACKUP-RESTORE.md](BACKUP-RESTORE.md).
- [ ] Rotate the IAM key on a schedule; deactivate the setup user; consider CloudTrail.
- [ ] Re-check `npm audit` after Next.js / Prisma major upgrades.

## Known limits (not blockers for a first internal launch)
- Logout does not revoke a copied session cookie (stateless sessions). Changing the password (now available under Account) or disabling the user revokes it at once; otherwise it lasts 7 days.
- HSTS is sent in production; there is no CSP and no 2FA.
- Real AWS behaviour (signed-header enforcement, Block Public Access, lifecycle) is verified only against an emulator until you run step 1.

## Handy: check that every env var the code reads is documented
```bash
grep -rhoE "process\.env\.[A-Z0-9_]+" src scripts | sort -u | sed 's/process\.env\.//' \
  | while read v; do grep -q "\`$v\`" docs/ENVIRONMENT.md || echo "undocumented: $v"; done
```
Only `DATABASE_URL`/`SESSION_SECRET`/`PORT`/`NODE_ENV`/`NODE_VERSION` style platform names may legitimately need a second look; anything else printed is a doc gap.
