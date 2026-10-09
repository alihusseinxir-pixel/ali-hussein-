import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { forgotPasswordAction } from "@/app/actions/auth";

export default function ForgotPasswordPage() {
  return (
    <>
      <h2 className="mb-1 text-lg font-semibold">نسيت كلمة المرور؟</h2>
      <p className="mb-4 text-sm text-slate-500">اكتب بريدك الإلكتروني وسنرسل لك رابطاً لاختيار كلمة مرور جديدة.</p>
      <ActionForm action={forgotPasswordAction} submitLabel="إرسال رابط الاستعادة" successMessage="إن كان هناك حساب بهذا البريد فسيصلك رابط الاستعادة.">
        <Field label="البريد الإلكتروني" name="email"><Input name="email" dir="ltr" type="email" autoComplete="email" required /></Field>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-slate-500"><Link className="text-brand-600 underline" href="/login">العودة لتسجيل الدخول</Link></p>
    </>
  );
}
