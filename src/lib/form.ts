import { z } from "zod";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; ok?: boolean } | undefined;

/** FormData -> plain object; blank strings preserved so zod `.optional()` handles them. */
export function formToObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}

export function zodErrors(err: z.ZodError): FormState {
  const fieldErrors: Record<string, string> = {};
  for (const i of err.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.message;
  return { error: Object.values(fieldErrors)[0] ?? "Invalid input", fieldErrors };
}
