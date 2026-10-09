import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { verifyCronAuth } from "@/lib/cron-auth";
import { runReminders } from "@/lib/reminders";
import { sendPendingEmails } from "@/lib/email-digest";
import { sendMail } from "@/lib/mailer";
import { json } from "@/lib/api-guard";

export const runtime = "nodejs";

/** POST /api/cron/reminders  with  Authorization: Bearer $CRON_SECRET  — call every ~5 minutes from any scheduler. */
export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET) return json({ error: "Cron is not configured (set CRON_SECRET)." }, 503);
  if (!verifyCronAuth(req.headers.get("authorization"), process.env.CRON_SECRET)) return json({ error: "Unauthorized" }, 401);
  const reminders = await runReminders({
    timezone: env.timezone, deadlineHours: Number(process.env.DEADLINE_REMINDER_HOURS) || undefined, publishHours: Number(process.env.PUBLISH_REMINDER_HOURS) || undefined,
  });
  const emails = await sendPendingEmails({ send: sendMail, enabled: !!process.env.SMTP_URL, appUrl: env.appUrl });
  return json({ reminders, emails });
}
