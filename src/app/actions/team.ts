"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { assertCan, ForbiddenError, ROLE_LABELS } from "@/lib/rbac";
import { sendMail } from "@/lib/mailer";
import { logActivity } from "@/lib/activity";
import { formToObject, zodErrors, type FormState } from "@/lib/form";
import { hashToken } from "@/lib/tokens";

const ROLES = ["ADMIN", "MARKETING_MANAGER", "SOCIAL_MEDIA_MANAGER", "VIDEOGRAPHER", "PHOTOGRAPHER", "VIDEO_EDITOR", "DESIGNER"] as const;

export async function inviteMemberAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireUser();
  try { assertCan(actor.role, "user:manage"); } catch (e) { if (e instanceof ForbiddenError) return { error: e.message }; throw e; }
  const parsed = z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email("Enter a valid email"),
    role: z.enum(ROLES),
    department: z.string().trim().max(100).optional(),
  }).safeParse(formToObject(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const d = parsed.data;
  if (await db.user.findUnique({ where: { email: d.email } })) return { error: "A user with this email already exists." };
  const token = randomBytes(32).toString("base64url");
  await db.$transaction(async (tx) => {
    await tx.invitation.deleteMany({ where: { organizationId: actor.organizationId, email: d.email, acceptedAt: null } });
    await tx.invitation.create({
      data: {
        organizationId: actor.organizationId, email: d.email, name: d.name, role: d.role, department: d.department || null,
        tokenHash: hashToken(token), invitedById: actor.id, expiresAt: new Date(Date.now() + 7 * 864e5),
      },
    });
    await logActivity(tx, { organizationId: actor.organizationId, actorId: actor.id, action: "user.invited", meta: { email: d.email, role: d.role } });
  });
  const link = `${env.appUrl}/invite/${token}`;
  await sendMail(d.email, `You're invited to ${actor.organization.name} on BASMA MARKETING`,
    `Hi ${d.name},\n\n${actor.name} invited you to join ${actor.organization.name} as ${ROLE_LABELS[d.role]}.\n\nAccept the invitation (valid for 7 days):\n${link}\n`);
  revalidatePath("/team");
  return { ok: true };
}

export async function revokeInvitationAction(fd: FormData) {
  const actor = await requireUser();
  assertCan(actor.role, "user:manage");
  await db.invitation.deleteMany({ where: { id: String(fd.get("id")), organizationId: actor.organizationId, acceptedAt: null } });
  revalidatePath("/team");
}

export async function updateMemberAction(fd: FormData) {
  const actor = await requireUser();
  assertCan(actor.role, "user:manage");
  const parsed = z.object({ id: z.string(), role: z.enum(ROLES).optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional() })
    .safeParse(formToObject(fd));
  if (!parsed.success) return;
  const { id, role, status } = parsed.data;
  const target = await db.user.findFirst({ where: { id, organizationId: actor.organizationId, deletedAt: null } });
  if (!target) return;
  // Never let an org lose its last active admin (incl. self-demotion).
  const losesAdmin = target.role === "ADMIN" && target.status === "ACTIVE" && ((role && role !== "ADMIN") || status === "DISABLED");
  if (losesAdmin) {
    const admins = await db.user.count({ where: { organizationId: actor.organizationId, role: "ADMIN", status: "ACTIVE", deletedAt: null } });
    if (admins <= 1) return;
  }
  await db.user.update({ where: { id }, data: { ...(role && { role }), ...(status && { status }) } });
  await logActivity(db, { organizationId: actor.organizationId, actorId: actor.id, action: "user.updated", meta: { userId: id, role, status } });
  revalidatePath("/team");
}
