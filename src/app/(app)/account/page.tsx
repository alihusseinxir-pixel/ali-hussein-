import { requireUser } from "@/lib/session";
import { ROLE_LABELS } from "@/lib/rbac";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { changePasswordAction } from "@/app/actions/auth";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="max-w-md space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">My account</h1>
        <p className="text-sm text-slate-500">{user.name} · {user.email} · {ROLE_LABELS[user.role]}</p>
      </div>
      <section>
        <h2 className="mb-1 font-medium">Change password</h2>
        <p className="mb-3 text-sm text-slate-500">Other devices will be signed out.</p>
        <ActionForm action={changePasswordAction} submitLabel="Change password" successMessage="Password changed.">
          <Field label="Current password" name="current"><Input name="current" type="password" autoComplete="current-password" required /></Field>
          <Field label="New password" name="password" hint="At least 10 characters"><Input name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
          <Field label="Repeat it" name="confirm"><Input name="confirm" type="password" autoComplete="new-password" minLength={10} required /></Field>
        </ActionForm>
      </section>
    </div>
  );
}
