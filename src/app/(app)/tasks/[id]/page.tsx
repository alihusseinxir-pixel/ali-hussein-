import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { can, ROLE_LABELS } from "@/lib/rbac";
import { getTask } from "@/lib/tasks";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/datetime";
import { STAGE_LABELS, firstAssigneeRoles, isReassignable, nextStage, workflowPath } from "@/lib/workflow";
import { TASK_FIELD_LABELS } from "@/lib/task-schema";
import { PriorityBadge, StageBadge } from "@/components/Badges";
import { AssignForm } from "@/components/AssignForm";
import { deleteTaskAction } from "@/app/actions/tasks";

const ACTION_LABELS: Record<string, string> = {
  "task.created": "created the task", "task.updated": "updated the task", "task.assigned": "assigned the task",
  "task.deadline_changed": "changed the deadline", "task.deleted": "deleted the task",
};

const Section = ({ title, value }: { title: string; value: string | null }) =>
  value ? <div><div className="label">{title}</div><p className="whitespace-pre-wrap text-sm">{value}</p></div> : null;

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const task = await getTask(user, id);
  if (!task) notFound();
  const tz = env.timezone;
  const path = workflowPath(task.contentType);
  const idx = path.indexOf(task.stage);
  const next = nextStage(task.contentType, task.stage);
  const previousOwners = task.assignments.filter((a) => a.releasedAt);
  const canEdit = can(user.role, "task:edit:any") || (can(user.role, "task:edit:own") && task.createdById === user.id);
  const canAssign = can(user.role, "task:assign") && isReassignable(task.stage);
  const assignable = canAssign
    ? await db.user.findMany({
        where: { organizationId: user.organizationId, status: "ACTIVE", deletedAt: null,
          role: { in: task.stage === "EDITING" ? ["VIDEO_EDITOR", "DESIGNER"] : firstAssigneeRoles(task.contentType) } },
        orderBy: { name: "asc" }, select: { id: true, name: true, role: true },
      })
    : [];
  const overdue = task.deadline && task.deadline < new Date() && !["PUBLISHED", "COMPLETED"].includes(task.stage);
  const wide = (["brief", "script"] as const);

  return (
    <div className="space-y-6">
      <header className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-slate-400">{task.taskCode}</div>
            <h1 className="text-2xl font-semibold">{task.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <StageBadge s={task.stage} /><PriorityBadge p={task.priority} />
              <span>{task.contentType.replace(/_/g, " ").toLowerCase()}{task.platform && ` · ${task.platform.toLowerCase()}`}</span>
              {task.brand && <span>· {task.brand.name}{task.campaign && ` / ${task.campaign.name}`}</span>}
            </div>
          </div>
          <div className="flex gap-2">
            {canEdit && !["PUBLISHED", "COMPLETED"].includes(task.stage) && <Link href={`/tasks/${id}/edit`} className="btn-secondary">Edit</Link>}
            {can(user.role, "task:delete") && (
              <form action={deleteTaskAction.bind(null, id)}><button className="btn-secondary text-red-600">Delete</button></form>
            )}
          </div>
        </div>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="label">Deadline</dt><dd className={overdue ? "font-medium text-red-600" : ""}>{formatDateTime(task.deadline, tz)}{overdue && " · overdue"}</dd></div>
          <div><dt className="label">Shooting</dt><dd>{formatDateTime(task.shootingAt, tz)}</dd></div>
          <div><dt className="label">Publishing</dt><dd>{formatDateTime(task.publishAt, tz)}</dd></div>
          <div><dt className="label">Current owner</dt><dd>{task.currentAssignee ? `${task.currentAssignee.name} (${ROLE_LABELS[task.currentAssignee.role]})` : "Unassigned"}</dd></div>
        </dl>
      </header>

      <section className="card">
        <h2 className="mb-3 font-medium">Workflow</h2>
        <ol className="flex flex-wrap gap-2 text-xs">
          {path.map((s, i) => (
            <li key={s} className={`rounded-full border px-3 py-1 ${i < idx ? "border-green-200 bg-green-50 text-green-700" : i === idx ? "border-brand-500 bg-brand-50 font-semibold text-brand-700" : "text-slate-400"}`}>
              {i < idx ? "✓ " : i === idx ? "● " : "○ "}{STAGE_LABELS[s]}
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2 className="mb-3 font-medium">Ownership</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="label">Created by</dt><dd>{task.createdBy.name} · {formatDateTime(task.createdAt, tz)}</dd></div>
          <div><dt className="label">Owns it now</dt><dd>{task.currentAssignee?.name ?? "—"}</dd></div>
          <div><dt className="label">Owned it before</dt><dd>{previousOwners.length ? previousOwners.map((a) => a.user.name).join(", ") : "—"}</dd></div>
          <div><dt className="label">Next stage</dt><dd>{next ? STAGE_LABELS[next] : "—"}</dd></div>
        </dl>
        {canAssign && (
          <div className="mt-4 border-t pt-4"><div className="label">{task.currentAssignee ? "Reassign" : "Assign"}</div>
            {assignable.length ? <AssignForm taskId={id} users={assignable} /> : <p className="text-sm text-slate-500">No active team member with a suitable role yet.</p>}</div>
        )}
      </section>

      <section className="card grid gap-5 md:grid-cols-2">
        <h2 className="font-medium md:col-span-2">Brief &amp; content</h2>
        {wide.map((k) => <div key={k} className="md:col-span-2"><Section title={TASK_FIELD_LABELS[k]} value={task[k]} /></div>)}
        {(Object.keys(TASK_FIELD_LABELS) as (keyof typeof TASK_FIELD_LABELS)[]).filter((k) => !wide.includes(k as never)).map((k) => <Section key={k} title={TASK_FIELD_LABELS[k]} value={task[k]} />)}
      </section>

      <section className="card">
          <h2 className="mb-3 font-medium">Activity log</h2>
          <ol className="space-y-3 border-l pl-4">
            {task.activityLogs.map((a) => (
              <li key={a.id} className="text-sm">
                <div className="text-xs text-slate-400">{formatDateTime(a.createdAt, tz)}</div>
                <b>{a.actor?.name ?? "System"}</b> {ACTION_LABELS[a.action] ?? a.action}
              </li>
            ))}
          </ol>
        </section>
      <p className="text-xs text-slate-400">Files, comments, handovers and approvals arrive in Phases 3–5.</p>
    </div>
  );
}
