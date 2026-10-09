import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { acceptInviteAction } from "@/app/actions/auth";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/tokens";
import { AR_ROLE } from "@/lib/i18n/ar";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await db.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { organization: true } });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) {
    return <p className="text-sm text-slate-600">هذه الدعوة غير صالحة أو منتهية. اطلب من المدير إرسال دعوة جديدة.</p>;
  }
  return (
    <>
      <h2 className="text-lg font-semibold">الانضمام إلى {inv.organization.name}</h2>
      <p className="mb-4 text-sm text-slate-500">تمت دعوتك بدور <b>{AR_ROLE[inv.role]}</b> (<bdi dir="ltr">{inv.email}</bdi>).</p>
      <ActionForm action={acceptInviteAction} submitLabel="قبول الدعوة">
        <input type="hidden" name="token" value={token} />
        <Field label="اسمك" name="name"><Input name="name" defaultValue={inv.name} required /></Field>
        <Field label="اختر كلمة مرور" name="password" hint="10 أحرف على الأقل"><Input name="password" dir="ltr" type="password" autoComplete="new-password" minLength={10} required /></Field>
      </ActionForm>
    </>
  );
}
