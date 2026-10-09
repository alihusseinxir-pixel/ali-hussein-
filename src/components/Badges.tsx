import type { Priority, TaskStage } from "@prisma/client";
import { AR_PRIORITY, AR_STAGE } from "@/lib/i18n/ar";

const PRIORITY: Record<Priority, string> = {
  LOW: "bg-slate-100 text-slate-600", MEDIUM: "bg-blue-50 text-blue-700", HIGH: "bg-amber-100 text-amber-800", URGENT: "bg-red-100 text-red-700",
};
const STAGE: Partial<Record<TaskStage, string>> = {
  PUBLISHED: "bg-green-100 text-green-700", COMPLETED: "bg-green-100 text-green-700", SCHEDULED: "bg-teal-100 text-teal-700",
  PRODUCTION: "bg-violet-100 text-violet-700", EDITING: "bg-indigo-100 text-indigo-700",
};
export const PriorityBadge = ({ p }: { p: Priority }) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY[p]}`}>{AR_PRIORITY[p]}</span>;
export const StageBadge = ({ s }: { s: TaskStage }) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE[s] ?? "bg-slate-100 text-slate-700"}`}>{AR_STAGE[s]}</span>;
