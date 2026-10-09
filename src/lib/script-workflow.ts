import type { ScriptStatus } from "@prisma/client";

/** Pure script-status rules (no I/O). "editor" = may edit the task; "reviewer" = holds approval:internal. */
export interface ScriptTransition { to: ScriptStatus; who: "editor" | "reviewer"; needsNote?: boolean; label: string }

export const SCRIPT_TRANSITIONS: Record<ScriptStatus, ScriptTransition[]> = {
  DRAFT: [{ to: "IN_REVIEW", who: "editor", label: "إرسال للمراجعة" }],
  IN_REVIEW: [
    { to: "APPROVED", who: "reviewer", label: "اعتماد السكريبت" },
    { to: "CHANGES_REQUESTED", who: "reviewer", needsNote: true, label: "طلب تعديلات" },
    { to: "DRAFT", who: "editor", label: "سحب من المراجعة" },
  ],
  CHANGES_REQUESTED: [
    { to: "IN_REVIEW", who: "editor", label: "إعادة الإرسال للمراجعة" },
    { to: "DRAFT", who: "editor", label: "العودة إلى مسودة" },
  ],
  APPROVED: [
    { to: "READY_FOR_PRODUCTION", who: "reviewer", label: "جاهز للتصوير" },
    { to: "DRAFT", who: "editor", label: "إعادة فتح للتعديل" },
  ],
  READY_FOR_PRODUCTION: [{ to: "DRAFT", who: "editor", label: "إعادة فتح للتعديل" }],
};

/** Scenes can only be changed while the script is a draft or has had changes requested; approval is never implied by an edit. */
export const EDITABLE: ScriptStatus[] = ["DRAFT", "CHANGES_REQUESTED"];

export const findTransition = (from: ScriptStatus, to: ScriptStatus) => SCRIPT_TRANSITIONS[from].find((t) => t.to === to);

export function allowedTransitions(from: ScriptStatus, perms: { editor: boolean; reviewer: boolean }) {
  return SCRIPT_TRANSITIONS[from].filter((t) => perms[t.who]);
}
