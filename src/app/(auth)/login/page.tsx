import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { loginAction } from "@/app/actions/auth";
import { env } from "@/lib/env";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  return (
    <>
      <h2 className="mb-4 text-lg font-semibold">تسجيل الدخول</h2>
      {reset && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.</p>}
      <ActionForm action={loginAction} submitLabel="دخول">
        <Field label="البريد الإلكتروني" name="email"><Input name="email" dir="ltr" type="email" autoComplete="email" required /></Field>
        <Field label="كلمة المرور" name="password"><Input name="password" dir="ltr" type="password" autoComplete="current-password" required /></Field>
      </ActionForm>
      <p className="mt-3 text-center text-sm"><Link className="text-brand-600 underline" href="/forgot-password">نسيت كلمة المرور؟</Link></p>
      {env.allowSignup && <p className="mt-4 text-center text-sm text-slate-500">شركة جديدة؟ <Link className="text-brand-600 underline" href="/register">أنشئ مؤسسة</Link></p>}
    </>
  );
}
