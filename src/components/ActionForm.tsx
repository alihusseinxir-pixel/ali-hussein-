"use client";
import { useActionState } from "react";
import type { FormState } from "@/lib/form";

export function ActionForm({
  action, children, submitLabel, className, successMessage,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  successMessage?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className ?? "space-y-4"}>
      {children}
      {state?.error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state?.ok && successMessage && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{successMessage}</p>}
      <button className="btn" disabled={pending}>{pending ? "Please wait…" : submitLabel}</button>
    </form>
  );
}
