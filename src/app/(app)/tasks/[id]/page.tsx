import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { can, ROLE_LABELS } from "@/lib/rbac";
import { getTask } from "@/lib/tasks";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/datetime";
import { STAGE_LABELS, exitPermission, firstAssigneeRoles, isHandoverStage, isReassignable, nextStage, revisionTarget, stageOwnerRoles, workflowPath } from "@/lib/workflow";
import { TASK_FIELD_LABELS } from "@/lib/task-schema";
import { PriorityBadge, StageBadge } from "@/components/Badges";
import { AssignForm } from "@/components/AssignForm";
import { CommentBox } from "@/components/CommentBox";
import { CommentThread } from "@/components/CommentThread";
import { ReviewCard } from "@/components/ReviewCard";
import { listComments, taskParticipants } from "@/lib/comments";
import { FilesPanel } from "@/components/FilesPanel";
import { MAX_UPLOAD_BYTES, listFiles } from "@/lib/files";
import { HandoverPanel } from "@/components/HandoverPanel";
import { acceptHandoverAction, deleteTaskAction } from "@/app/actions/tasks";

const ACTION_LABELS: Record<string, string> = {
  "task.created": "created the task", "task.updated": "updated the task", "task.assigned": "assigned the task",
  "task.deadline_changed": "changed the deadline", "handover.created": "handed the task over", "handover.accepted": "confirmed the handover", "file.uploaded": "uploaded a file", "file.replaced": "uploaded a new file version", "file.deleted": "removed a file", "comment.added": "commented", "comment.deleted": "deleted a comment", "task.approved": "approved the task", "stage.changed": "moved the task to the next stage", "revision.requested": "requested changes", "task.deleted": "deleted the task",
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
  const isOwner = task.currentAssigneeId === user.id || user.role === "ADMIN";
  const need = exitPermission(task.stage);
  const pendingForMe = task.handoffs.find((h) => h.status === "PENDING" && h.toUser.id === user.id && task.currentAssigneeId === user.id);
  const canHandOver = isOwner && !pendingForMe && next !== null && isHandoverStage(task.stage) && (!need || can(user.role, need));
  const candidates = canHandOver && next
    ? await db.user.findMany({ where: { organizationId: user.organizationId, status: "ACTIVE", deletedAt: null, role: { in: stageOwnerRoles(next) } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } })
    : [];
  const revertTo = canHandOver ? revisionTarget(task.contentType, task.stage) : null;
  const files = await listFiles(user, id);
  const canUpload = !["PUBLISHED", "COMPLETED"].includes(task.stage) && (isOwner || task.createdById === user.id || can(user.role, "task:edit:any"));
  const fileRows = files.map((f) => ({
    id: f.id, fileName: f.fileName, fileType: f.fileType, kind: f.kind, version: f.version, sizeBytes: f.sizeBytes,
    uploadedBy: f.uploadedBy.name, createdAt: f.createdAt.toISOString(),
    canDelete: canUpload && (f.uploadedById === user.id || can(user.role, "task:edit:any")),
  }));
  const [comments, ctx] = await Promise.all([listComments(user, id), taskParticipants(user, id)]);
  const people = ctx?.people ?? [];
  const inReview = ["PRODUCTION_REVIEW", "EDITING_REVIEW", "INTERNAL_APPROVAL", "SOCIAL_APPROVAL"].includes(task.stage);
  const submitLabel = task.stage === "SOCIAL_APPROVAL" ? "Approve & Schedule" : inReview ? "Approve & hand over" : "Confirm handover";
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

      <FilesPanel taskId={id} files={fileRows} canUpload={canUpload} maxMb={MAX_UPLOAD_BYTES / 1024 / 1024} />

      {pendingForMe && (
        <section className="card border-brand-500 bg-brand-50">
          <h2 className="font-medium">Handover waiting for your confirmation</h2>
          <p className="my-2 whitespace-pre-wrap text-sm">{pendingForMe.instructions || "—"}</p>
          <form action={acceptHandoverAction.bind(null, id)}><input type="hidden" name="handoffId" value={pendingForMe.id} />
            <button className="btn">{task.stage === "ASSIGNED" ? "Confirm & start work" : "Confirm handover"}</button></form>
        </section>
      )}
      {inReview && isOwner && <ReviewCard task={task} files={files} tz={tz} />}
      {canHandOver && next && <HandoverPanel taskId={id} from={task.stage} to={next} candidates={candidates} revertTo={revertTo} tz={tz} submitLabel={submitLabel} />}

      <section className="card grid gap-5 md:grid-cols-2">
        <h2 className="font-medium md:col-span-2">Brief &amp; content</h2>
        {wide.map((k) => <div key={k} className="md:col-span-2"><Section title={TASK_FIELD_LABELS[k]} value={task[k]} /></div>)}
        {(Object.keys(TASK_FIELD_LABELS) as (keyof typeof TASK_FIELD_LABELS)[]).filter((k) => !wide.includes(k as never)).map((k) => <Section key={k} title={TASK_FIELD_LABELS[k]} value={task[k]} />)}
      </section>

      <section className="card">
        <h2 className="mb-3 font-medium">Handovers</h2>
        {task.handoffs.length === 0 ? <p className="text-sm text-slate-500">No handovers yet.</p> : (
          <ol className="space-y-4">
            {task.handoffs.map((h) => {
              const p = h.payload as { deliverables?: string | null; files?: { fileName: string; version: number; kind: string }[] } | null;
              return (
                <li key={h.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <b>{h.fromUser.name} → {h.toUser.name}</b>
                    <span className="text-xs text-slate-400">{formatDateTime(h.createdAt, tz)} · {h.status.toLowerCase()}{h.acceptedAt && ` ${formatDateTime(h.acceptedAt, tz)}`}</span>
                  </div>
                  <div className="text-xs text-slate-500">{STAGE_LABELS[h.fromStage]} → {STAGE_LABELS[h.toStage]}{h.deadline && ` · due ${formatDateTime(h.deadline, tz)}`}</div>
                  {h.instructions && <p className="mt-2 whitespace-pre-wrap"><span className="label !inline">Instructions </span>{h.instructions}</p>}
                  {h.requiredOutput && <p><span className="label !inline">Expected output </span>{h.requiredOutput}</p>}
                  {p?.deliverables && <p className="whitespace-pre-wrap"><span className="label !inline">Delivered </span>{p.deliverables}</p>}
                  {p?.files && p.files.length > 0 && <p><span className="label !inline">Files </span>{p.files.map((f) => `${f.fileName} (V${f.version})`).join(", ")}</p>}
                  {h.reason && h.reason !== h.instructions && <p className="whitespace-pre-wrap"><span className="label !inline">Why </span>{h.reason}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="card">
        <h2 className="mb-3 font-medium">Approvals &amp; revisions</h2>
        {task.approvals.length === 0 ? <p className="text-sm text-slate-500">No approvals or change requests yet.</p> : (
          <ol className="space-y-3">
            {task.approvals.map((a) => (
              <li key={a.id} className="text-sm">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.status === "APPROVED" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"}`}>{a.status === "APPROVED" ? "Approved" : "Changes requested"}</span>{" "}
                <b>{a.approver.name}</b> <span className="text-slate-500">at {STAGE_LABELS[a.stage]} · {formatDateTime(a.createdAt, tz)}</span>
                {a.comments && <p className="mt-1 whitespace-pre-wrap text-slate-700">{a.comments}</p>}
                {a.status === "CHANGES_REQUESTED" && (() => {
                  const r = task.revisions.find((x) => x.stage === a.stage && Math.abs(x.createdAt.getTime() - a.createdAt.getTime()) < 5000);
                  return r ? <p className="text-xs text-slate-400">{r.resolvedAt ? `Resolved ${formatDateTime(r.resolvedAt, tz)}` : "Open — waiting for a new version"}</p> : null;
                })()}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card space-y-4">
        <h2 className="font-medium">Comments</h2>
        <CommentThread taskId={id} comments={comments} people={people} meId={user.id} isAdmin={user.role === "ADMIN"} tz={tz} />
        {can(user.role, "task:comment") && <CommentBox taskId={id} people={people.filter((p) => p.id !== user.id)} />}
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
      <p className="text-xs text-slate-400">Calendar, PDF brief and notifications arrive in Phases 6–8.</p>
    </div>
  );
}
