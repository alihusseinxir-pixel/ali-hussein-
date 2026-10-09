import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { getTask } from "@/lib/tasks";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/datetime";
import { exitPermission, firstAssigneeRoles, isHandoverStage, isReassignable, nextStage, revisionTarget, stageOwnerRoles, workflowPath } from "@/lib/workflow";
import { TASK_FIELD_LABELS } from "@/lib/task-schema";
import { PriorityBadge, StageBadge } from "@/components/Badges";
import { AR_SCRIPT_STATUS, AR_ROLE, AR_STAGE, AR_CONTENT_TYPE, AR_PLATFORM } from "@/lib/i18n/ar";
import { AssignForm } from "@/components/AssignForm";
import { CommentBox } from "@/components/CommentBox";
import { CommentThread } from "@/components/CommentThread";
import { ReviewCard } from "@/components/ReviewCard";
import { listComments, taskParticipants } from "@/lib/comments";
import { extraEntries } from "@/lib/templates";
import { resolveTemplateRef } from "@/lib/templates-db";
import { BriefPanel } from "@/components/BriefPanel";
import { FilesPanel } from "@/components/FilesPanel";
import { MAX_UPLOAD_BYTES, listFiles } from "@/lib/files";
import { HandoverPanel } from "@/components/HandoverPanel";
import { TaskTeamPanel } from "@/components/TaskTeamPanel";
import { visibleShootsWhere } from "@/lib/shoots";
import { SCRIPT_CLEARED } from "@/lib/blockers";
import { AR_SHOOT_STATUS } from "@/lib/i18n/ar";
import { listCollaborators, listTaskChecklist } from "@/lib/task-team";
import { acceptHandoverAction, deleteTaskAction } from "@/app/actions/tasks";

const ACTION_LABELS: Record<string, string> = {
  "task.created": "أنشأ المهمة", "task.updated": "عدّل المهمة", "task.assigned": "أسند المهمة", "task.deadline_changed": "غيّر الموعد النهائي",
  "handover.created": "سلّم المهمة", "handover.accepted": "أكّد التسليم", "file.uploaded": "رفع ملفاً", "file.replaced": "رفع نسخة جديدة من ملف", "file.deleted": "حذف ملفاً",
  "comment.added": "علّق", "comment.deleted": "حذف تعليقاً", "brief.shared": "أنشأ رابط مشاركة للملخص", "brief.share_revoked": "ألغى روابط مشاركة الملخص",
  "task.approved": "وافق على المهمة", "stage.changed": "نقل المهمة إلى المرحلة التالية", "revision.requested": "طلب تعديلات", "task.deleted": "حذف المهمة",
  "script.saved": "حفظ السكريبت", "script.status": "غيّر حالة السكريبت", "script.scene_task_created": "أنشأ مهمة فرعية من مشهد",
  "task.collaborator_added": "أضاف متعاوناً", "task.collaborator_removed": "أزال متعاوناً",
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
  const template = await resolveTemplateRef(user.organizationId, task.templateRef);
  const extras = extraEntries(template, task.extra as Record<string, string> | null);
  const files = await listFiles(user, id);
  const canUpload = !["PUBLISHED", "COMPLETED"].includes(task.stage) && (isOwner || task.createdById === user.id || can(user.role, "task:edit:any"));
  const fileRows = files.map((f) => ({
    id: f.id, fileName: f.fileName, fileType: f.fileType, kind: f.kind, version: f.version, sizeBytes: f.sizeBytes,
    uploadedBy: f.uploadedBy.name, createdAtLabel: formatDateTime(f.createdAt, tz),
    canDelete: canUpload && (f.uploadedById === user.id || can(user.role, "task:edit:any")),
  }));
  const [comments, ctx, collabs, checklist] = await Promise.all([listComments(user, id), taskParticipants(user, id), listCollaborators(user, id), listTaskChecklist(user, id)]);
  const closed = ["PUBLISHED", "COMPLETED"].includes(task.stage);
  const shoots = await db.shootSession.findMany({ where: { AND: [visibleShootsWhere(user), { contents: { some: { taskId: id } } }] }, orderBy: { startsAt: "asc" }, select: { id: true, title: true, startsAt: true, status: true } });
  const scriptBlocked = !SCRIPT_CLEARED.includes(task.scriptStatus) && shoots.some((s) => s.status === "PLANNED");
  const canManageTeam = can(user.role, "task:edit:any") || can(user.role, "task:assign") || canEdit;
  const canWorkList = canManageTeam || task.currentAssigneeId === user.id || collabs.some((c) => c.userId === user.id);
  const collabCandidates = canManageTeam && !closed
    ? await db.user.findMany({ where: { organizationId: user.organizationId, status: "ACTIVE", deletedAt: null, id: { notIn: [...collabs.map((c) => c.userId), ...(task.currentAssigneeId ? [task.currentAssigneeId] : [])] } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } })
    : [];
  const doneByNames = Object.fromEntries((await db.user.findMany({ where: { id: { in: checklist.flatMap((c) => (c.doneById ? [c.doneById] : [])) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const people = ctx?.people ?? [];
  const inReview = ["PRODUCTION_REVIEW", "EDITING_REVIEW", "INTERNAL_APPROVAL", "SOCIAL_APPROVAL"].includes(task.stage);
  const submitLabel = task.stage === "SOCIAL_APPROVAL" ? "اعتماد وجدولة" : inReview ? "اعتماد وتسليم" : "تأكيد التسليم";
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
              <span>{AR_CONTENT_TYPE[task.contentType]}{task.platform && ` · ${AR_PLATFORM[task.platform]}`}</span>
              {task.brand && <span>· {task.brand.name}{task.campaign && ` / ${task.campaign.name}`}</span>}
              {task.brand?.guidelinesUrl && /^https?:\/\//i.test(task.brand.guidelinesUrl) && <a href={task.brand.guidelinesUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 underline">إرشادات البراند</a>}
              {template && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">{template.name}</span>}
            </div>
          </div>
          <div className="flex gap-2">
            {can(user.role, "shoot:manage") && <Link href={`/shoots/new?task=${id}`} className="btn-secondary">تخطيط تصوير</Link>}
            <Link href={`/tasks/${id}/script`} className="btn-secondary">السكريبت · {AR_SCRIPT_STATUS[task.scriptStatus]}</Link>
            {canEdit && !["PUBLISHED", "COMPLETED"].includes(task.stage) && <Link href={`/tasks/${id}/edit`} className="btn-secondary">تعديل</Link>}
            {can(user.role, "task:delete") && (
              <form action={deleteTaskAction.bind(null, id)}><button className="btn-secondary text-red-600">حذف</button></form>
            )}
          </div>
        </div>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="label">الموعد النهائي</dt><dd className={overdue ? "font-medium text-red-600" : ""}><bdi>{formatDateTime(task.deadline, tz)}</bdi>{overdue && " · متأخرة"}</dd></div>
          <div><dt className="label">التصوير</dt><dd><bdi>{formatDateTime(task.shootingAt, tz)}</bdi></dd></div>
          <div><dt className="label">النشر</dt><dd><bdi>{formatDateTime(task.publishAt, tz)}</bdi></dd></div>
          <div><dt className="label">المالك الحالي</dt><dd>{task.currentAssignee ? `${task.currentAssignee.name} (${AR_ROLE[task.currentAssignee.role]})` : "غير مسندة"}</dd></div>
        </dl>
      </header>

      {(shoots.length > 0 || scriptBlocked) && (
        <section className="card space-y-2">
          <h2 className="font-medium">جلسات التصوير</h2>
          {scriptBlocked && <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">⚠ لهذا المحتوى جلسة تصوير مخططة لكن السكريبت غير معتمد بعد (الحالة: {AR_SCRIPT_STATUS[task.scriptStatus]}). <Link className="underline" href={`/tasks/${id}/script`}>فتح السكريبت</Link></p>}
          <ul className="divide-y text-sm">
            {shoots.map((s) => <li key={s.id} className="py-1.5"><Link href={`/shoots/${s.id}`} className="text-brand-600 underline">{s.title}</Link> <span className="text-slate-500">· <bdi>{formatDateTime(s.startsAt, tz)}</bdi> · {AR_SHOOT_STATUS[s.status]}</span></li>)}
          </ul>
        </section>
      )}

      <TaskTeamPanel taskId={id} collaborators={collabs.map((c) => c.user)} candidates={collabCandidates} checklist={checklist}
        nameOf={doneByNames} userId={user.id} canManage={canManageTeam} canWork={canWorkList} readOnly={closed} />

      <section className="card">
        <h2 className="mb-3 font-medium">مسار العمل</h2>
        <ol className="flex flex-wrap gap-2 text-xs">
          {path.map((s, i) => (
            <li key={s} className={`rounded-full border px-3 py-1 ${i < idx ? "border-green-200 bg-green-50 text-green-700" : i === idx ? "border-brand-500 bg-brand-50 font-semibold text-brand-700" : "text-slate-400"}`}>
              {i < idx ? "✓ " : i === idx ? "● " : "○ "}{AR_STAGE[s]}
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2 className="mb-3 font-medium">الملكية</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="label">أنشأها</dt><dd>{task.createdBy.name} · <bdi>{formatDateTime(task.createdAt, tz)}</bdi></dd></div>
          <div><dt className="label">مسؤول الآن</dt><dd>{task.currentAssignee?.name ?? "—"}</dd></div>
          <div><dt className="label">كان مسؤولاً سابقاً</dt><dd>{previousOwners.length ? previousOwners.map((a) => a.user.name).join("، ") : "—"}</dd></div>
          <div><dt className="label">المرحلة التالية</dt><dd>{next ? AR_STAGE[next] : "—"}</dd></div>
        </dl>
        {canAssign && (
          <div className="mt-4 border-t pt-4"><div className="label">{task.currentAssignee ? "إعادة الإسناد" : "إسناد"}</div>
            {assignable.length ? <AssignForm taskId={id} users={assignable} /> : <p className="text-sm text-slate-500">لا يوجد عضو نشط بدور مناسب بعد.</p>}</div>
        )}
      </section>

      <BriefPanel taskId={id} canShare={canEdit} />

      <FilesPanel taskId={id} files={fileRows} canUpload={canUpload} maxMb={MAX_UPLOAD_BYTES / 1024 / 1024} />

      {pendingForMe && (
        <section className="card border-brand-500 bg-brand-50">
          <h2 className="font-medium">تسليم بانتظار تأكيدك</h2>
          <p className="my-2 whitespace-pre-wrap text-sm">{pendingForMe.instructions || "—"}</p>
          <form action={acceptHandoverAction.bind(null, id)}><input type="hidden" name="handoffId" value={pendingForMe.id} />
            <button className="btn">{task.stage === "ASSIGNED" ? "تأكيد وبدء العمل" : "تأكيد التسليم"}</button></form>
        </section>
      )}
      {inReview && isOwner && <ReviewCard task={task} files={files} tz={tz} />}
      {canHandOver && next && <HandoverPanel taskId={id} from={task.stage} to={next} candidates={candidates} revertTo={revertTo} tz={tz} submitLabel={submitLabel} />}

      <section className="card grid gap-5 md:grid-cols-2">
        <h2 className="font-medium md:col-span-2">الملخص والمحتوى</h2>
        {wide.map((k) => <div key={k} className="md:col-span-2"><Section title={TASK_FIELD_LABELS[k]} value={task[k]} /></div>)}
        {extras.map((e) => <Section key={e.label} title={e.label} value={e.value} />)}
        {(Object.keys(TASK_FIELD_LABELS) as (keyof typeof TASK_FIELD_LABELS)[]).filter((k) => !wide.includes(k as never)).map((k) => <Section key={k} title={TASK_FIELD_LABELS[k]} value={task[k]} />)}
      </section>

      <section className="card">
        <h2 className="mb-3 font-medium">التسليمات</h2>
        {task.handoffs.length === 0 ? <p className="text-sm text-slate-500">لا توجد تسليمات بعد.</p> : (
          <ol className="space-y-4">
            {task.handoffs.map((h) => {
              const p = h.payload as { deliverables?: string | null; files?: { fileName: string; version: number; kind: string }[] } | null;
              return (
                <li key={h.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <b>{h.fromUser.name} → {h.toUser.name}</b>
                    <span className="text-xs text-slate-400">{formatDateTime(h.createdAt, tz)} · {h.status === "PENDING" ? "بانتظار التأكيد" : h.status === "ACCEPTED" ? "مؤكَّد" : "مرفوض"}{h.acceptedAt && ` ${formatDateTime(h.acceptedAt, tz)}`}</span>
                  </div>
                  <div className="text-xs text-slate-500">{AR_STAGE[h.fromStage]} ← {AR_STAGE[h.toStage]}{h.deadline && ` · الموعد ${formatDateTime(h.deadline, tz)}`}</div>
                  {h.instructions && <p className="mt-2 whitespace-pre-wrap"><span className="label !inline">التعليمات </span>{h.instructions}</p>}
                  {h.requiredOutput && <p><span className="label !inline">المخرج المتوقع </span>{h.requiredOutput}</p>}
                  {p?.deliverables && <p className="whitespace-pre-wrap"><span className="label !inline">المُسلَّم </span>{p.deliverables}</p>}
                  {p?.files && p.files.length > 0 && <p><span className="label !inline">الملفات </span>{p.files.map((f) => `${f.fileName} (V${f.version})`).join(", ")}</p>}
                  {h.reason && h.reason !== h.instructions && <p className="whitespace-pre-wrap"><span className="label !inline">السبب </span>{h.reason}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="card">
        <h2 className="mb-3 font-medium">الموافقات والتعديلات</h2>
        {task.approvals.length === 0 ? <p className="text-sm text-slate-500">لا توجد موافقات أو طلبات تعديل بعد.</p> : (
          <ol className="space-y-3">
            {task.approvals.map((a) => (
              <li key={a.id} className="text-sm">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.status === "APPROVED" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"}`}>{a.status === "APPROVED" ? "موافقة" : "مطلوب تعديلات"}</span>{" "}
                <b>{a.approver.name}</b> <span className="text-slate-500">عند {AR_STAGE[a.stage]} · {formatDateTime(a.createdAt, tz)}</span>
                {a.comments && <p className="mt-1 whitespace-pre-wrap text-slate-700">{a.comments}</p>}
                {a.status === "CHANGES_REQUESTED" && (() => {
                  const r = task.revisions.find((x) => x.stage === a.stage && Math.abs(x.createdAt.getTime() - a.createdAt.getTime()) < 5000);
                  return r ? <p className="text-xs text-slate-400">{r.resolvedAt ? `تمت المعالجة ${formatDateTime(r.resolvedAt, tz)}` : "مفتوح — بانتظار نسخة جديدة"}</p> : null;
                })()}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card space-y-4">
        <h2 className="font-medium">التعليقات</h2>
        <CommentThread taskId={id} comments={comments} people={people} meId={user.id} isAdmin={user.role === "ADMIN"} tz={tz} />
        {can(user.role, "task:comment") && <CommentBox taskId={id} people={people.filter((p) => p.id !== user.id)} />}
      </section>

      <section className="card">
          <h2 className="mb-3 font-medium">سجل الأنشطة</h2>
          <ol className="space-y-3 border-s ps-4">
            {task.activityLogs.map((a) => (
              <li key={a.id} className="text-sm">
                <div className="text-xs text-slate-400">{formatDateTime(a.createdAt, tz)}</div>
                <b>{a.actor?.name ?? "النظام"}</b> {ACTION_LABELS[a.action] ?? a.action}
              </li>
            ))}
          </ol>
        </section>
    </div>
  );
}
