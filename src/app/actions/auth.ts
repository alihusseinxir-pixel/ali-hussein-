"use server";
import { logError } from "@/lib/log-safe";
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hashPassword, verifyPassword, dummyVerify } from "@/lib/password";
import { createSession, destroySession, requireUser } from "@/lib/session";
import { changePassword } from "@/lib/account";
import { rateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";
import { hashToken } from "@/lib/tokens";
import { requestPasswordReset, resetPassword } from "@/lib/password-reset";
import { sendMail } from "@/lib/mailer";
import { formToObject, zodErrors, type FormState } from "@/lib/form";

const password = z.string().min(10, "كلمة المرور 10 أحرف على الأقل").max(200);
const email = z.string().trim().toLowerCase().email("أدخل بريداً إلكترونياً صالحاً");

async function clientKey() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = z.object({ email, password: z.string().min(1) }).safeParse(formToObject(fd));
  if (!parsed.success) return { error: "أدخل البريد وكلمة المرور." };
  const { email: addr, password: pw } = parsed.data;
  if (!rateLimit(`login:${await clientKey()}:${addr}`, 8, 15 * 60_000)) {
    return { error: "محاولات كثيرة. حاول بعد دقائق." };
  }
  const user = await db.user.findFirst({ where: { email: addr, deletedAt: null } });
  if (!user) {
    await dummyVerify(pw);
    return { error: "البريد أو كلمة المرور غير صحيحة." };
  }
  if (!(await verifyPassword(pw, user.passwordHash)) || user.status !== "ACTIVE") {
    return { error: "البريد أو كلمة المرور غير صحيحة." };
  }
  await createSession(user.id, user.sessionVersion);
  redirect("/dashboard");
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "org";

export async function registerAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!env.allowSignup) return { error: "التسجيل معطّل. اطلب دعوة من المدير." };
  const parsed = z
    .object({ organization: z.string().trim().min(2).max(100), name: z.string().trim().min(2).max(100), email, password })
    .safeParse(formToObject(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const d = parsed.data;
  if (!rateLimit(`register:${await clientKey()}`, 5, 60 * 60_000)) return { error: "تسجيلات كثيرة. حاول لاحقاً." };
  if (await db.user.findUnique({ where: { email: d.email } })) return { error: "يوجد حساب بهذا البريد بالفعل." };
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
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) return { error: "هذه الدعوة غير صالحة أو منتهية." };
  if (await db.user.findUnique({ where: { email: inv.email } })) return { error: "يوجد حساب بهذا البريد بالفعل." };
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
  if (!user) return { error: "استُخدمت هذه الدعوة من قبل." };
  await createSession(user.id, user.sessionVersion);
  redirect("/dashboard");
}

export async function forgotPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = z.object({ email }).safeParse(formToObject(fd));
  if (!parsed.success) return { error: "أدخل بريداً إلكترونياً صالحاً." };
  if (!rateLimit(`forgot:${await clientKey()}:${parsed.data.email}`, 3, 15 * 60_000)) return { error: "طلبات كثيرة. حاول بعد دقائق." };
  try {
    await requestPasswordReset(parsed.data.email, { send: sendMail, appUrl: env.appUrl });
  } catch (e) {
    logError("forgot-password", e); // never reveal whether the account exists or mail failed
  }
  return { ok: true };
}

export async function resetPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = z.object({ token: z.string().min(20), password, confirm: z.string() }).safeParse(formToObject(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  if (parsed.data.password !== parsed.data.confirm) return { error: "كلمتا المرور غير متطابقتين." };
  if (!rateLimit(`reset:${await clientKey()}`, 10, 15 * 60_000)) return { error: "محاولات كثيرة. حاول لاحقاً." };
  const r = await resetPassword(parsed.data.token, parsed.data.password);
  if (r !== "ok") return { error: "رابط الاستعادة غير صالح أو منتهي. اطلب رابطاً جديداً." };
  redirect("/login?reset=1");
}

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z.object({ current: z.string().min(1, "أدخل كلمة المرور الحالية"), password, confirm: z.string() }).safeParse(formToObject(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  if (parsed.data.password !== parsed.data.confirm) return { error: "كلمتا المرور غير متطابقتين." };
  if (!rateLimit(`chpw:${user.id}`, 8, 15 * 60_000)) return { error: "محاولات كثيرة. حاول بعد دقائق." };
  const r = await changePassword(user.id, parsed.data.current, parsed.data.password);
  if (!r.ok) {
    const msg = { wrong_password: "Your current password is incorrect.", weak: "Choose a password of at least 10 characters.", same: "The new password must be different.", unavailable: "This account is unavailable." }[r.reason];
    return { error: msg };
  }
  await createSession(user.id, r.sessionVersion); // keep this device signed in; all others are signed out
  return { ok: true };
}
