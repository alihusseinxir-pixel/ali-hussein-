"use client";
import { useOptimistic, useTransition } from "react";
import { removeChecklistItemAction, toggleChecklistAction } from "@/app/actions/shoots";

export function ChecklistItem({ shootId, id, label, done, doneBy, canCheck, canRemove }: {
  shootId: string; id: string; label: string; done: boolean; doneBy?: string | null; canCheck: boolean; canRemove: boolean;
}) {
  const [pending, start] = useTransition();
  const [shown, setShown] = useOptimistic(done);
  return (
    <li className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={shown} disabled={!canCheck} onChange={(e) => { const v = e.target.checked; start(async () => { setShown(v); await toggleChecklistAction(shootId, id, v); }); }} />
        <span className={shown ? "text-slate-400 line-through" : ""}>{label}</span>
        {shown && doneBy && <span className="text-xs text-slate-400">({doneBy})</span>}
      </label>
      {canRemove && <button type="button" disabled={pending} onClick={() => start(() => removeChecklistItemAction(shootId, id))} className="text-xs text-red-600 underline" aria-label={`حذف: ${label}`}>حذف</button>}
    </li>
  );
}
