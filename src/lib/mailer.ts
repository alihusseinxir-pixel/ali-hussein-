import "server-only";
import nodemailer from "nodemailer";

export async function sendMail(to: string, subject: string, text: string) {
  const from = process.env.MAIL_FROM ?? "BASMA MARKETING <no-reply@basma.local>";
  const smtp = process.env.SMTP_URL;
  if (!smtp) {
    console.log(`\n[mail:dev] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  await nodemailer.createTransport(smtp).sendMail({ from, to, subject, text });
}
