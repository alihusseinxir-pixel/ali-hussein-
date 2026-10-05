import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { resetPasswordAction } from "@/app/actions/auth";
import { isResetTokenValid } from "@/lib/password-reset";

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await isResetTokenValid(token))) {
    return <p className="text-sm text-slate-600">This reset link is invalid or has expired. <Link className="text-brand-600 underline" href="/forgot-password">Request a new one</Link>.</p>;
  }
  return (
    <>
      <h2 className="mb-4 text-lg font-semibold">Choose a new password</h2>
      <ActionForm action={resetPasswordAction} submitLabel="Change password">
        <input type="hidden" name="token" value={token} />
        <Field label="New password" name="password" hint="At least 10 characters"><Input name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <Field label="Repeat it" name="confirm"><Input name="confirm" type="password" autoComplete="new-password" minLength={10} required /></Field>
      </ActionForm>
    </>
  );
}
