import { ActionForm } from "./ActionForm";
import { TaskChecklistItem } from "./TaskChecklist";
import { AR_ROLE } from "@/lib/i18n/ar";
import { addCollaboratorAction, addTaskChecklistItemAction, removeCollaboratorAction } from "@/app/actions/task-team";
import type { Role } from "@prisma/client";

interface Person { id: string; name: string; role: Role }

/** Collaborators + task checklist. `readOnly` is true once the task is published/completed. */
export function TaskTeamPanel({ taskId, collaborators, candidates, checklist, nameOf, userId, canManage, canWork, readOnly }: {
  taskId: string; collaborators: Person[]; candidates: Person[];
  checklist: { id: string; label: string; done: boolean; doneById: string | null }[];
  nameOf: Record<string, string>; userId: string; canManage: boolean; canWork: boolean; readOnly: boolean;
}) {
  const done = checklist.filter((c) => c.done).length;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="card">
        <h2 className="mb-2 font-medium">المتعاونون</h2>
        {collaborators.length === 0 ? <p className="text-sm text-slate-500">لا يوجد متعاونون. المسؤول الوحيد عن المهمة هو المالك الحالي.</p> : (
          <ul className="divide-y">
            {collaborators.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-1.5 text-sm">
                <span>{c.name} <span className="text-xs text-slate-400">{AR_ROLE[c.role]}</span></span>
                {!readOnly && (canManage || c.id === userId) && <form action={removeCollaboratorAction.bind(null, taskId, c.id)}><button className="text-xs text-red-600 underline">{c.id === userId && !canManage ? "مغادرة" : "إزالة"}</button></form>}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && canManage && candidates.length > 0 && (
          <ActionForm action={addCollaboratorAction.bind(null, taskId)} submitLabel="إضافة" className="mt-3 flex flex-wrap items-start gap-2">
            <select name="userId" className="input !w-auto min-w-48" aria-label="إضافة متعاون" required defaultValue="">
              <option value="" disabled>اختر عضواً…</option>
              {candidates.map((u) => <option key={u.id} value={u.id}>{u.name} — {AR_ROLE[u.role]}</option>)}
            </select>
          </ActionForm>
        )}
      </section>
      <section className="card">
        <h2 className="mb-2 font-medium">قائمة المهام الفرعية <span className="text-xs text-slate-400">{done}/{checklist.length}</span></h2>
        {checklist.length === 0 && <p className="text-sm text-slate-500">لا توجد عناصر بعد.</p>}
        <ul className="divide-y">
          {checklist.map((c) => <TaskChecklistItem key={c.id} taskId={taskId} id={c.id} label={c.label} done={c.done} doneBy={c.doneById ? nameOf[c.doneById] : null} canEdit={canWork && !readOnly} />)}
        </ul>
        {!readOnly && canWork && (
          <ActionForm action={addTaskChecklistItemAction.bind(null, taskId)} submitLabel="إضافة" className="mt-3 flex items-start gap-2">
            <input name="label" className="input" placeholder="عنصر جديد" maxLength={300} required aria-label="عنصر جديد في القائمة" />
          </ActionForm>
        )}
      </section>
    </div>
  );
}
