import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { resetPasswordAction } from "@/app/actions/auth";
import { isResetTokenValid } from "@/lib/password-reset";

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await isResetTokenValid(token))) {
    return <p className="text-sm text-slate-600">رابط الاستعادة غير صالح أو منتهي. <Link className="text-brand-600 underline" href="/forgot-password">اطلب رابطاً جديداً</Link>.</p>;
  }
  return (
    <>
      <h2 className="mb-4 text-lg font-semibold">اختر كلمة مرور جديدة</h2>
      <ActionForm action={resetPasswordAction} submitLabel="تغيير كلمة المرور">
        <input type="hidden" name="token" value={token} />
        <Field label="كلمة المرور الجديدة" name="password" hint="10 أحرف على الأقل"><Input name="password" dir="ltr" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <Field label="أعد كتابتها" name="confirm"><Input name="confirm" dir="ltr" type="password" autoComplete="new-password" minLength={10} required /></Field>
      </ActionForm>
    </>
  );
}
