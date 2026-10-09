import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { registerAction } from "@/app/actions/auth";

export default function RegisterPage() {
  return (
    <>
      <h2 className="mb-4 text-lg font-semibold">إنشاء مؤسستك</h2>
      <ActionForm action={registerAction} submitLabel="إنشاء الحساب">
        <Field label="اسم المؤسسة" name="organization"><Input name="organization" required /></Field>
        <Field label="اسمك" name="name"><Input name="name" autoComplete="name" required /></Field>
        <Field label="البريد الإلكتروني" name="email"><Input name="email" dir="ltr" type="email" autoComplete="email" required /></Field>
        <Field label="كلمة المرور" name="password" hint="10 أحرف على الأقل"><Input name="password" dir="ltr" type="password" autoComplete="new-password" minLength={10} required /></Field>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-slate-500">لديك حساب؟ <Link className="text-brand-600 underline" href="/login">سجّل الدخول</Link></p>
    </>
  );
}
