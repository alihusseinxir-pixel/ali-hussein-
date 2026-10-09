# Deploying BASMA MARKETING on Render

This gives the team a real URL (`https://<name>.onrender.com`). The repository contains `render.yaml` (a Render *Blueprint*):
one command-less setup that creates the database, the web app and a reminders cron job.

> **Secrets rule.** Nothing in `render.yaml` is secret. Secrets (SMTP, AWS keys) are typed into Render's dashboard when you
> apply the Blueprint, where Render stores them encrypted. Never commit them, never paste them into chat.

## What gets created (Frankfurt region)

| Resource | Purpose | Notes |
|---|---|---|
| `basma-db` (PostgreSQL) | all data | paid plan; the free database **expires after 30 days** |
| `basma-marketing` (Web service, Node 22) | the app | build `npm ci --include=dev && npm run build`; start `npx prisma migrate deploy && npm start`; health check `/api/health` |
| `basma-reminders` (Cron job, every 5 min) | deadline/overdue/publishing reminders + email digests | runs `npm run reminders`; billed per second with a monthly minimum |

Plan names in `render.yaml` (`starter`, `basic-256mb`) were taken from Render's published documentation via search, because the docs site could not be fetched from the
environment where this was written. Render validates the Blueprint before applying it and names any plan it does not accept; edit the plan there if its catalogue changed.
Check current prices on Render's pricing page before you apply (at the time of writing roughly: web starter ≈ $7/month, database basic-256mb ≈ $6/month, cron ≥ $1/month).
A free web service sleeps after 15 minutes without traffic and has an ephemeral disk, so it is only suitable for a quick look.

## Before you start

1. **A Render account** connected to your GitHub account (Render → Account Settings → GitHub).
2. **The code on a branch Render can read.** The work lives on `claude/basma-marketing-workflow-ca50ky` (Pull Request #1). Either merge the PR into `main` first (recommended; you decide when) or choose that branch when creating the Blueprint.
3. **An SMTP provider** for email. In production the app prints no emails, so without SMTP *invitations and password resets cannot be delivered*. Any provider with SMTP works (Brevo, Resend, SendGrid, your own). You need a URL like `smtps://USER:PASSWORD@smtp.example.com:465` and a verified sender address for `MAIL_FROM`.
4. **The S3 bucket** from [STORAGE.md](STORAGE.md) (use a *separate production* bucket and a *separate production* IAM user, not your development ones). Render is not AWS, so the app uses that IAM user's access key. Set CORS on the bucket for your final app URL.

## Steps

1. Render dashboard → **New → Blueprint** → pick the repository and branch → Render reads `render.yaml`.
2. Fill the prompted values:
   - `APP_URL`: `https://basma-marketing.onrender.com` (use the exact URL Render shows for the service, or your custom domain). No trailing slash. If you only learn the URL after the first deploy, put a placeholder now and correct it right after (step 4).
   - `SMTP_URL`, `MAIL_FROM`.
   - `S3_BUCKET`, `AWS_REGION` (must equal the bucket's region), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
   - For the cron job: `APP_URL`, `SMTP_URL`, `MAIL_FROM` again (same values).
3. **Apply.** Watch the web service's logs: you should see `migrations found`, `successfully applied`, then `Ready`. The health check turns green.
4. Open the service URL. If `APP_URL` was a placeholder, fix it now (Environment → `APP_URL`, also on the cron job) and let the service restart. `APP_URL` is used in email links and for the S3 CORS origin.
5. **Create your organization:** click *Create an organization* on the login page. The first account becomes Admin. **Do not run `npm run db:seed` in production** — it creates demo accounts with a publicly known password.
6. **Close public sign-up:** set `ALLOW_SIGNUP` to `false` on the web service (otherwise anyone who finds the URL can create an organization). Then invite your team from *Team → Invite a member*.
7. **S3 hardening and CORS** for the production bucket (see STORAGE.md): Block Public Access ON, ACLs disabled, CORS allowing `PUT` from exactly your `APP_URL`, lifecycle expiry for `pending/`. Then verify from your own machine with the production bucket values in a local, git-ignored file:
   `npx tsx --env-file=.env.production-check --conditions=react-server scripts/verify-storage.ts` (every line ✔).
8. Do a real test: upload a file in a task, preview it, download it; check an invitation email arrives; run through one task from creation to approval.

## Updating

Pushing to the connected branch redeploys automatically. Migrations run at start, so schema changes ship with the code. To roll back, redeploy a previous commit from Render's *Events* tab (database migrations are forward-only: restore from a backup if a migration must be undone).

## Operating notes

- **Backups:** confirm what your Render database plan includes (retention, point-in-time restore) in Render's documentation, and take your own `pg_dump` before risky changes.
- **Logs** never contain credentials or email bodies in production (errors are redacted by `src/lib/log-safe.ts`).
- **Custom domain:** add it in the web service's *Settings → Custom Domains*, then update `APP_URL` and the bucket's CORS origin.
- **Scaling:** one instance is the supported setup. The login rate limiter is in-memory per instance, so do not run several instances until it is moved to a shared store.
- **Cost control:** the cron job and database bill even when nobody uses the app.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Deploy fails at `npm run build` with missing module `typescript`/`tailwindcss` | The build command lost `--include=dev`. |
| Service restarts in a loop, log shows `Missing required environment variable SESSION_SECRET` / `DATABASE_URL` | Environment values missing. `SESSION_SECRET` is generated by the Blueprint; `DATABASE_URL` comes from the database. |
| Health check fails | The database is unreachable (check it is in the same region and `DATABASE_URL` is the *internal* URL) or migrations failed (read the log). |
| Invitations / password reset do nothing | `SMTP_URL` is missing or wrong (check the provider's logs). |
| Uploads fail with "Could not reach the file storage" | CORS on the bucket does not list your exact `APP_URL`. |
| File links give Access Denied | S3 credentials/region/bucket variables are wrong or the IAM policy lacks `GetObject`. |
| Everything works but reminders never arrive | The cron job's `APP_URL`/`SMTP_URL` were not set, or the job is not deployed (check its *Logs*). |

## What has and has not been verified

Verified locally by simulating Render's own steps (fresh copy of the repository, `npm ci --include=dev && npm run build`, then `npx prisma migrate deploy && npm start` with
`NODE_ENV=production`, `PORT` set and **no `.env` file**, on an empty database): the build, migrations, startup, `/api/health` (200 when the database is up; 503 with no detail when it is down),
the login page, creating an organization without any seed data, and the cron command. `render.yaml` parses and contains no secret values.
**Not verified**: the Blueprint on Render itself (not reachable from the authoring environment), Render plan names and prices, SMTP delivery, and S3 against real AWS.
Render shows Blueprint validation errors before it creates anything, so a wrong plan name is caught at the first step.
