# Test & audit report — Social Media Team Management (BASMA MARKETING)

Scope: the whole application after stages 1–6 (Arabic/RTL shell, script editor, shoot planning, task board/collaborators/checklists, workflow integration, settings). Everything below was actually run; nothing is claimed that was not.

## Commands

```bash
cp .env.example .env            # fill DATABASE_URL and SESSION_SECRET (openssl rand -base64 32)
npm ci
npx prisma migrate deploy       # or `npx prisma migrate dev` locally
npm run db:seed                 # optional demo data: admin@demo.test / basma-demo-123 (+ manager@, social@, video@, photo@, editor@, designer@)
npm run dev                     # development, http://localhost:3000
npm run build && npm start      # production
```

Checks (the integration tests need the Postgres from `DATABASE_URL`):

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

## Results

| Check | Result |
|---|---|
| `npm run typecheck` | passed |
| `npm run lint` | passed, no warnings |
| `npm test` | 43 files, 255 tests passed |
| `npm run build` | passed |
| Production-build crawl, 7 roles, mobile viewport (390 px), 109–120 pages each | no 4xx/5xx, no horizontal scroll, every page RTL |
| Production-build crawl of a brand-new empty organization (empty states) | 120 pages, no errors |
| Unauthenticated access to 24 protected routes (pages and APIs) | all redirect to `/login` |
| Forged session cookie | pages redirect to `/login`, API returns 401 |
| Unknown ids (`/tasks/zzz`, `/shoots/zzz`, `/api/files/zzz`, …) as 5 roles | 404 everywhere, never 500 |
| Manager-only pages as production roles (videographer, designer) | redirected to the dashboard with `?denied=1` |
| Cron endpoint without `CRON_SECRET` | 503 (disabled) |
| Full lifecycle test (idea → script review → approval → shoot → scene sub-tasks → production → editing → approvals → published → completed) | passed, with every approval recorded against a reviewer |
| Secrets scan of tracked files | nothing real; `.env` is git-ignored; CI uses a throwaway local DB credential |

## What the audit found and fixed

1. **Mobile navigation** showed only Home / Tasks / Calendar, so phone users could not reach Shoots, Settings, Campaigns or Team. Added a full, role-filtered menu that closes after navigation.
2. **Shoot budget** was visible to crew on a shoot. It is now hidden from everyone who cannot manage shoots (covered by a test).
3. **Brand guidelines link** could be saved but was never shown. It now appears on the task page (http/https links only).
4. **Duplicate-title rule** broke 14 older integration tests that deliberately reuse titles; those tests now pass `allowDuplicate`. The rule itself is unchanged and has its own tests.

## Known limitations (not fixed)

- **Dependencies:** `npm audit --omit=dev` reports 5 issues (PostCSS inside Next.js, `deepmerge-ts` inside the Prisma CLI). They are build-time tooling that does not process untrusted CSS or config, and the suggested fixes are a major Next.js upgrade and an odd Prisma downgrade, so they were left alone. Plan the Next.js 16 upgrade separately.
- **Roles are fixed.** Custom roles are intentionally out of version 1.
- **Workflow rules are warnings, not gates:** an unapproved script does not stop a hand-over; it shows as a blocker on the dashboard and the task page.
- **Duplicate-title check is not atomic**: two simultaneous creates can both pass it.
- **Dates:** older pages still format dates in English. "Tomorrow / in N days" wording uses UTC days.
- **Calendar:** a task with `shootingAt` plus a linked shoot session can appear twice.
- **Shoot attachments** are not implemented (files are attached to the linked content tasks).
- **Not tested:** real SMTP delivery, S3 storage against a real bucket, Render deployment, and browsers other than Chromium.

## Open issue: intermittent hydration warning

In long production-build crawls, React reports error #418 (server HTML and client render differ) on roughly one page load in several hundred. It was seen on calendar pages and once on a task page, for several different roles. It could not be reproduced with focused loops (42 + 90 + 8×3 loads of calendar pages, 0 errors) and the pages rendered normally each time. Root cause is not yet identified; a dev-mode crawl capturing the full mismatch text was still running when this was written. Treat it as unresolved, low severity.
