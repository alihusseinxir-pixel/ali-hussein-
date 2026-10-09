import { requireUser } from "@/lib/session";
import { AR_ROLE } from "@/lib/i18n/ar";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { changePasswordAction } from "@/app/actions/auth";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="max-w-md space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">حسابي</h1>
        <p className="text-sm text-slate-500">{user.name} · <bdi dir="ltr">{user.email}</bdi> · {AR_ROLE[user.role]}</p>
      </div>
      <section>
        <h2 className="mb-1 font-medium">تغيير كلمة المرور</h2>
        <p className="mb-3 text-sm text-slate-500">سيُسجَّل خروجك من الأجهزة الأخرى.</p>
        <ActionForm action={changePasswordAction} submitLabel="تغيير كلمة المرور" successMessage="تم تغيير كلمة المرور.">
          <Field label="كلمة المرور الحالية" name="current"><Input name="current" dir="ltr" type="password" autoComplete="current-password" required /></Field>
          <Field label="كلمة المرور الجديدة" name="password" hint="10 أحرف على الأقل"><Input name="password" dir="ltr" type="password" autoComplete="new-password" minLength={10} required /></Field>
          <Field label="أعد كتابتها" name="confirm"><Input name="confirm" dir="ltr" type="password" autoComplete="new-password" minLength={10} required /></Field>
        </ActionForm>
      </section>
    </div>
  );
}
