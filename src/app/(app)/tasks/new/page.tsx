import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { ActionForm } from "@/components/ActionForm";
import { TaskForm } from "@/components/TaskForm";
import { createTaskAction } from "@/app/actions/tasks";

export default async function NewTask() {
  const user = await requirePermission("task:create");
  const org = { organizationId: user.organizationId, deletedAt: null };
  const [brands, campaigns, assignees] = await Promise.all([
    db.brand.findMany({ where: org, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.campaign.findMany({ where: org, orderBy: { name: "asc" }, select: { id: true, name: true, brandId: true } }),
    db.user.findMany({
      where: { ...org, status: "ACTIVE", role: { in: ["VIDEOGRAPHER", "PHOTOGRAPHER", "DESIGNER"] } },
      orderBy: { name: "asc" }, select: { id: true, name: true, role: true },
    }),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Create Task</h1>
      <ActionForm action={createTaskAction} submitLabel="Create task" className="space-y-6">
        <TaskForm brands={brands} campaigns={campaigns} assignees={assignees} />
      </ActionForm>
    </div>
  );
}
