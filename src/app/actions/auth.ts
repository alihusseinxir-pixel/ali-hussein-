"use server";
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hashPassword, verifyPassword, dummyVerify } from "@/lib/password";
import { createSession, destroySession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";
import { hashToken } from "@/lib/tokens";
import { requestPasswordReset, resetPassword } from "@/lib/password-reset";
import { sendMail } from "@/lib/mailer";
import { formToObject, zodErrors, type FormState } from "@/lib/form";

const password = z.string().min(10, "Password must be at least 10 characters").max(200);
const email = z.string().trim().toLowerCase().email("Enter a valid email");

async function clientKey() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = z.object({ email, password: z.string().min(1) }).safeParse(formToObject(fd));
  if (!parsed.success) return { error: "Enter your email and password." };
  const { email: addr, password: pw } = parsed.data;
  if (!rateLimit(`login:${await clientKey()}:${addr}`, 8, 15 * 60_000)) {
    return { error: "Too many attempts. Try again in a few minutes." };
  }
  const user = await db.user.findFirst({ where: { email: addr, deletedAt: null } });
  if (!user) {
    await dummyVerify(pw);
    return { error: "Invalid email or password." };
  }
  if (!(await verifyPassword(pw, user.passwordHash)) || user.status !== "ACTIVE") {
    return { error: "Invalid email or password." };
  }
  await createSession(user.id, user.sessionVersion);
  redirect("/dashboard");
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "org";

export async function registerAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!env.allowSignup) return { error: "Sign-up is disabled. Ask an administrator for an invitation." };
  const parsed = z
    .object({ organization: z.string().trim().min(2).max(100), name: z.string().trim().min(2).max(100), email, password })
    .safeParse(formToObject(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const d = parsed.data;
  if (!rateLimit(`register:${await clientKey()}`, 5, 60 * 60_000)) return { error: "Too many sign-ups. Try again later." };
  if (await db.user.findUnique({ where: { email: d.email } })) return { error: "An account with this email already exists." };
  const passwordHash = await hashPassword(d.password);
  const user = await db.$transaction(async (tx) => {
    const base = slugify(d.organization);
    const slug = (await tx.organization.findUnique({ where: { slug: base } })) ? `${base}-${randomBytes(3).toString("hex")}` : base;
    const org = await tx.organization.create({ data: { name: d.organization, slug } });
    const u = await tx.user.create({ data: { organizationId: org.id, name: d.name, email: d.email, passwordHash, role: "ADMIN" } });
    await logActivity(tx, { organizationId: org.id, actorId: u.id, action: "org.created", meta: { name: org.name } });
    return u;
  });
  await createSession(user.id, user.sessionVersion);
  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function acceptInviteAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = z
    .object({ token: z.string().min(20), name: z.string().trim().min(2).max(100), password })
    .safeParse(formToObject(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const { token, name, password: pw } = parsed.data;
  const inv = await db.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) return { error: "This invitation is invalid or has expired." };
  if (await db.user.findUnique({ where: { email: inv.email } })) return { error: "An account with this email already exists." };
  const passwordHash = await hashPassword(pw);
  const user = await db.$transaction(async (tx) => {
    // Claim the invite atomically so a token can only be used once.
    const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
    if (claimed.count === 0) throw new Error("claimed");
    const u = await tx.user.create({
      data: { organizationId: inv.organizationId, name, email: inv.email, passwordHash, role: inv.role, department: inv.department },
    });
    await logActivity(tx, { organizationId: inv.organizationId, actorId: u.id, action: "user.joined", meta: { role: inv.role } });
    return u;
  }).catch(() => null);
  if (!user) return { error: "This invitation has already been used." };
  await createSession(user.id, user.sessionVersion);
  redirect("/dashboard");
}

export async function forgotPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = z.object({ email }).safeParse(formToObject(fd));
  if (!parsed.success) return { error: "Enter a valid email." };
  if (!rateLimit(`forgot:${await clientKey()}:${parsed.data.email}`, 3, 15 * 60_000)) return { error: "Too many requests. Try again in a few minutes." };
  try {
    await requestPasswordReset(parsed.data.email, { send: sendMail, appUrl: env.appUrl });
  } catch (e) {
    console.error("[forgot-password]", e); // never reveal whether the account exists or mail failed
  }
  return { ok: true };
}

export async function resetPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = z.object({ token: z.string().min(20), password, confirm: z.string() }).safeParse(formToObject(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  if (parsed.data.password !== parsed.data.confirm) return { error: "The two passwords do not match." };
  if (!rateLimit(`reset:${await clientKey()}`, 10, 15 * 60_000)) return { error: "Too many attempts. Try again later." };
  const r = await resetPassword(parsed.data.token, parsed.data.password);
  if (r !== "ok") return { error: "This reset link is invalid or has expired. Request a new one." };
  redirect("/login?reset=1");
}
