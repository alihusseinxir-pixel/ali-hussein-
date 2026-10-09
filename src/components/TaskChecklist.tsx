"use client";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { removeTaskChecklistItemAction, toggleTaskChecklistAction } from "@/app/actions/task-team";

export function TaskChecklistItem({ taskId, id, label, done, doneBy, canEdit, sceneNumber }: { taskId: string; id: string; label: string; done: boolean; doneBy?: string | null; canEdit: boolean; sceneNumber?: number | null }) {
  const [pending, start] = useTransition();
  const [shown, setShown] = useOptimistic(done);
  return (
    <li className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={shown} disabled={!canEdit}
          onChange={(e) => { const v = e.target.checked; start(async () => { setShown(v); await toggleTaskChecklistAction(taskId, id, v); }); }} />
        <span className={shown ? "text-slate-400 line-through" : ""}>{label}</span>
        {sceneNumber && <Link href={`/tasks/${taskId}/script#scene-${sceneNumber}`} className="text-xs text-brand-600 underline">← السكريبت</Link>}
        {shown && doneBy && <span className="text-xs text-slate-400">({doneBy})</span>}
      </label>
      {canEdit && <button type="button" disabled={pending} onClick={() => start(() => removeTaskChecklistItemAction(taskId, id))} className="text-xs text-red-600 underline" aria-label={`حذف: ${label}`}>حذف</button>}
    </li>
  );
}
