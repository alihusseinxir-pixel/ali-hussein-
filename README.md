# BASMA MARKETING

Marketing Workflow & Content Management System — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run locally
```bash
cp .env.example .env            # set DATABASE_URL and a 32+ char SESSION_SECRET
npm install
npx prisma migrate dev          # creates the schema
npm run db:seed                 # optional demo org: admin@demo.test / basma-demo-123 (+ one account per role)
npm run dev                     # http://localhost:3000
```
Invitation emails are printed to the server console unless `SMTP_URL` is set.

## Checks
```bash
npm run typecheck && npm test && npm run build
```
`npm test` includes integration tests that need the Postgres from `DATABASE_URL`.

## Config
`DATABASE_URL`, `SESSION_SECRET`, `APP_URL`, `APP_TIMEZONE` (default `Asia/Riyadh`), `ALLOW_SIGNUP` (`false` to disable new-org sign-up), `SMTP_URL`, `MAIL_FROM`.
