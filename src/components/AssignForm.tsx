import { ActionForm } from "./ActionForm";
import { assignTaskAction } from "@/app/actions/tasks";
import { AR_ROLE as ROLE_LABELS } from "@/lib/i18n/ar";
import type { Role } from "@prisma/client";

export function AssignForm({ taskId, users }: { taskId: string; users: { id: string; name: string; role: Role }[] }) {
  return (
    <ActionForm action={assignTaskAction.bind(null, taskId)} submitLabel="إسناد" className="flex flex-wrap items-end gap-2" successMessage="تم الإسناد.">
      <select name="assigneeId" className="input !w-64" defaultValue="">
        <option value="" disabled>اختر شخصاً…</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name} — {ROLE_LABELS[u.role]}</option>)}
      </select>
    </ActionForm>
  );
}
