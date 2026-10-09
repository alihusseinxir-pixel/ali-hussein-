import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { registerAction } from "@/app/actions/auth";

export default function RegisterPage() {
  return (
    <>
      <h2 className="mb-4 text-lg font-semibold">Create your organization</h2>
      <ActionForm action={registerAction} submitLabel="Create account">
        <Field label="Organization" name="organization"><Input name="organization" required /></Field>
        <Field label="Your name" name="name"><Input name="name" autoComplete="name" required /></Field>
        <Field label="Email" name="email"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" name="password" hint="At least 10 characters"><Input name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-slate-500">Already have an account? <Link className="text-brand-600 underline" href="/login">Sign in</Link></p>
    </>
  );
}
