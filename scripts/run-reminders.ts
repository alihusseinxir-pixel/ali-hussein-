// For system cron:  */5 * * * *  cd /app && npm run reminders
import { PrismaClient } from "@prisma/client";
import { runReminders } from "../src/lib/reminders";
import { sendPendingEmails } from "../src/lib/email-digest";
import { sendMail } from "../src/lib/mailer";

async function main() {
  const reminders = await runReminders({
    timezone: process.env.APP_TIMEZONE ?? "Asia/Riyadh",
    deadlineHours: Number(process.env.DEADLINE_REMINDER_HOURS) || undefined,
    publishHours: Number(process.env.PUBLISH_REMINDER_HOURS) || undefined,
  });
  const emails = await sendPendingEmails({ send: sendMail, enabled: !!process.env.SMTP_URL, appUrl: process.env.APP_URL ?? "http://localhost:3000" });
  console.log(JSON.stringify({ reminders, emails }));
  await new PrismaClient().$disconnect();
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
