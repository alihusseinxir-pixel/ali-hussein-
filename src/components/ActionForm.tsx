"use client";
import { startTransition, useActionState, useEffect, useRef } from "react";
import type { FormState } from "@/lib/form";

/**
 * Submits through a transition instead of `<form action>` so React 19 does not wipe the
 * fields after a failed submit. Fields are cleared only on success.
 */
export function ActionForm({
  action, children, submitLabel, className, successMessage, danger,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  children?: React.ReactNode;
  submitLabel: string;
  className?: string;
  successMessage?: string;
  danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form
      ref={ref}
      className={className ?? "space-y-4"}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      {children}
      {state?.error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state?.ok && successMessage && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{successMessage}</p>}
      <button className={danger ? "inline-flex items-center justify-center rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60" : "btn"} disabled={pending}>{pending ? "الرجاء الانتظار…" : submitLabel}</button>
    </form>
  );
}
