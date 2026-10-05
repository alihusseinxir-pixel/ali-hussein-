import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { getTask } from "@/lib/tasks";
import { ActionForm } from "@/components/ActionForm";
import { TaskForm } from "@/components/TaskForm";
import { updateTaskAction } from "@/app/actions/tasks";

export default async function EditTask({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const task = await getTask(user, id);
  if (!task) notFound();
  if (!(can(user.role, "task:edit:any") || (can(user.role, "task:edit:own") && task.createdById === user.id))) redirect(`/tasks/${id}`);
  const org = { organizationId: user.organizationId, deletedAt: null };
  const [brands, campaigns] = await Promise.all([
    db.brand.findMany({ where: org, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.campaign.findMany({ where: org, orderBy: { name: "asc" }, select: { id: true, name: true, brandId: true } }),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Edit {task.taskCode}</h1>
      <ActionForm action={updateTaskAction.bind(null, id)} submitLabel="Save changes" className="space-y-6">
        <TaskForm task={task} brands={brands} campaigns={campaigns} />
      </ActionForm>
    </div>
  );
}
