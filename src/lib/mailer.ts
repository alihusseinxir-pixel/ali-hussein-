import "server-only";
import nodemailer from "nodemailer";

export async function sendMail(to: string, subject: string, text: string) {
  const from = process.env.MAIL_FROM ?? "BASMA MARKETING <no-reply@basma.local>";
  const smtp = process.env.SMTP_URL;
  if (!smtp) {
    // Development convenience only: the body contains single-use links (invitations, password resets), i.e. credentials.
    if (process.env.NODE_ENV === "production") console.warn(`[mail] SMTP_URL is not set; an email to ${to} was NOT sent.`);
    else console.log(`\n[mail:dev] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  await nodemailer.createTransport(smtp).sendMail({ from, to, subject, text });
}
