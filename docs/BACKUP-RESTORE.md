# Backup and restore

What must survive a disaster: the **PostgreSQL database** (all tasks, history, users) and the **S3 bucket** (uploaded files).
Code is in Git; secrets are in Render's dashboard (keep a copy of the environment variable *names and where each value came from* in your password manager, never in Git).

## Database (Render PostgreSQL)
1. Render dashboard → `basma-db` → **Backups**: confirm automatic backups are on for your plan, and note the retention period.
2. Take a manual logical backup before risky changes (uses the *external* connection string from the dashboard; keep it out of shell history and chat):
   ```bash
   pg_dump --format=custom --no-owner "$EXTERNAL_DATABASE_URL" > basma-$(date +%F).dump
   ```
   You must first allow your IP in the database's access list (`render.yaml` sets it empty = internal only); remove it afterwards.
3. **Test a restore at least once before go-live**, into a throwaway database:
   ```bash
   createdb basma_restore_test
   pg_restore --no-owner --dbname basma_restore_test basma-YYYY-MM-DD.dump
   DATABASE_URL=postgresql://localhost/basma_restore_test npx prisma migrate status   # must say up to date
   ```
4. To restore for real: restore into a new Render database (or via the dashboard's point-in-time recovery if your plan has it), point `DATABASE_URL` at it, redeploy. Migrations are idempotent and run at start.

## Files (S3)
- Enable **bucket versioning** (protects against accidental deletes/overwrites) and, if needed, a lifecycle rule that expires old noncurrent versions.
- For disaster recovery, enable cross-region replication or periodically `aws s3 sync` to a second private bucket.
- The `pending/` prefix holds abandoned uploads and is expired after 1 day by `setup-bucket.ts`; do not back it up.
- Database rows reference files by key, so restore the DB and the bucket **from the same time window** where possible.

## Rotation and incident response
- Rotate the IAM access key on a schedule (create the new key, update Render, redeploy, then delete the old key).
- If a key leaks: deactivate it in IAM first, then rotate; check CloudTrail for use.
- Rotating `SESSION_SECRET` signs everyone out and invalidates outstanding share links.
- Known limit: a copied session cookie stays valid until expiry (7 days) even after sign-out. Changing the password, or an admin disabling the user, revokes it immediately.
