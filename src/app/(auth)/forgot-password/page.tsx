import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { forgotPasswordAction } from "@/app/actions/auth";

export const dynamic = "force-dynamic"; // reads SMTP_URL at request time, not build time

export default function ForgotPasswordPage() {
  if (!process.env.SMTP_URL) {
    return (
      <>
        <h2 className="mb-1 text-lg font-semibold">Forgot your password?</h2>
        <p className="mb-4 text-sm text-slate-500">Ask your administrator for a reset link (Team → Password reset link). It is valid for 1 hour.</p>
        <p className="mt-4 text-center text-sm text-slate-500"><Link className="text-brand-600 underline" href="/login">Back to sign in</Link></p>
      </>
    );
  }
  return (
    <>
      <h2 className="mb-1 text-lg font-semibold">Forgot your password?</h2>
      <p className="mb-4 text-sm text-slate-500">Enter your email and we&apos;ll send a link to choose a new one.</p>
      <ActionForm action={forgotPasswordAction} submitLabel="Send reset link" successMessage="If an account exists for that email, a reset link is on its way.">
        <Field label="Email" name="email"><Input name="email" type="email" autoComplete="email" required /></Field>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-slate-500"><Link className="text-brand-600 underline" href="/login">Back to sign in</Link></p>
    </>
  );
}
