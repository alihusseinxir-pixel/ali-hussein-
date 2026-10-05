import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { acceptInviteAction } from "@/app/actions/auth";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/tokens";
import { ROLE_LABELS } from "@/lib/rbac";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await db.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { organization: true } });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) {
    return <p className="text-sm text-slate-600">This invitation is invalid or has expired. Ask your administrator to send a new one.</p>;
  }
  return (
    <>
      <h2 className="text-lg font-semibold">Join {inv.organization.name}</h2>
      <p className="mb-4 text-sm text-slate-500">You were invited as <b>{ROLE_LABELS[inv.role]}</b> ({inv.email}).</p>
      <ActionForm action={acceptInviteAction} submitLabel="Accept invitation">
        <input type="hidden" name="token" value={token} />
        <Field label="Your name" name="name"><Input name="name" defaultValue={inv.name} required /></Field>
        <Field label="Choose a password" name="password" hint="At least 10 characters"><Input name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
      </ActionForm>
    </>
  );
}
