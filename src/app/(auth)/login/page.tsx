import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { loginAction } from "@/app/actions/auth";
import { env } from "@/lib/env";

export default function LoginPage() {
  return (
    <>
      <h2 className="mb-4 text-lg font-semibold">Sign in</h2>
      <ActionForm action={loginAction} submitLabel="Sign in">
        <Field label="Email" name="email"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" name="password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
      </ActionForm>
      {env.allowSignup && <p className="mt-4 text-center text-sm text-slate-500">New company? <Link className="text-brand-600 underline" href="/register">Create an organization</Link></p>}
    </>
  );
}
