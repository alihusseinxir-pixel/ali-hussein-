import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { loginAction } from "@/app/actions/auth";
import { env } from "@/lib/env";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  return (
    <>
      <h2 className="mb-4 text-lg font-semibold">Sign in</h2>
      {reset && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Password changed. Sign in with your new password.</p>}
      <ActionForm action={loginAction} submitLabel="Sign in">
        <Field label="Email" name="email"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" name="password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
      </ActionForm>
      <p className="mt-3 text-center text-sm"><Link className="text-brand-600 underline" href="/forgot-password">Forgot your password?</Link></p>
      {env.allowSignup && <p className="mt-4 text-center text-sm text-slate-500">New company? <Link className="text-brand-600 underline" href="/register">Create an organization</Link></p>}
    </>
  );
}
