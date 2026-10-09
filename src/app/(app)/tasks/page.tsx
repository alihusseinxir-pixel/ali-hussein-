import Link from "next/link";
import type { Priority, TaskStage } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { listTasks, type TaskFilters } from "@/lib/tasks";
import { can } from "@/lib/rbac";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/datetime";
import { PRIORITIES } from "@/lib/task-schema";
import { AR_PRIORITY, AR_STAGE } from "@/lib/i18n/ar";
import { DUE_FILTERS, WORK_STATUSES, WORK_STATUS_LABEL, workStatus, type DueFilter, type WorkStatus } from "@/lib/work-status";
import { PriorityBadge, StageBadge } from "@/components/Badges";

type SP = Record<string, string | undefined>;
const DUE_LABEL: Record<DueFilter, string> = { overdue: "متأخرة", today: "اليوم", week: "خلال 7 أيام", none: "بدون موعد" };
const CLOSED = ["PUBLISHED", "COMPLETED"];

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = sp.view === "board" ? "board" : "list";
  const filters: TaskFilters = {
    q: sp.q?.trim() || undefined,
    stage: sp.stage && sp.stage in AR_STAGE ? (sp.stage as TaskStage) : undefined,
    workStatus: (WORK_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as WorkStatus) : undefined,
    priority: sp.priority && (PRIORITIES as readonly string[]).includes(sp.priority) ? (sp.priority as Priority) : undefined,
    due: (DUE_FILTERS as readonly string[]).includes(sp.due ?? "") ? (sp.due as DueFilter) : undefined,
    assigneeId: sp.assigneeId || undefined,
    campaignId: sp.campaignId || undefined,
    mine: sp.mine === "1",
    sort: sp.sort === "created" || sp.sort === "priority" ? sp.sort : "deadline",
    page: Number(sp.page) || 1,
    all: view === "board",
  };
  const showAssignee = can(user.role, "task:view:all");
  const [{ items, total, page, pages }, people, overdueMine] = await Promise.all([
    listTasks(user, filters),
    showAssignee ? db.user.findMany({ where: { organizationId: user.organizationId, status: "ACTIVE", deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    filters.mine ? listTasks(user, { mine: true, due: "overdue" }).then((r) => r.total) : Promise.resolve(0),
  ]);
  const qs = (over: SP) => `/tasks?${new URLSearchParams(Object.entries({ ...sp, ...over }).filter(([, v]) => v) as [string, string][])}`;
  const now = new Date();
  const isLate = (t: (typeof items)[number]) => !!t.deadline && t.deadline < now && !CLOSED.includes(t.stage);
  const statusOf = (t: (typeof items)[number]) => workStatus(t.stage, t.revisions.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{filters.mine ? "مهامي" : "المهام"} <span className="text-base font-normal text-slate-400">({total})</span></h1>
        <div className="flex gap-2">
          <div className="inline-flex overflow-hidden rounded-md border text-sm" role="group" aria-label="طريقة العرض">
            <Link href={qs({ view: "list" })} aria-current={view === "list"} className={`px-3 py-2 ${view === "list" ? "bg-brand-600 text-white" : "bg-white"}`}>قائمة</Link>
            <Link href={qs({ view: "board" })} aria-current={view === "board"} className={`px-3 py-2 ${view === "board" ? "bg-brand-600 text-white" : "bg-white"}`}>لوحة</Link>
          </div>
          {can(user.role, "task:create") && <Link href="/tasks/new" className="btn">+ مهمة جديدة</Link>}
        </div>
      </div>

      {filters.mine && overdueMine > 0 && (
        <p role="status" className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">لديك {overdueMine} مهمة متأخرة. <Link className="underline" href={qs({ due: "overdue", page: undefined })}>عرضها</Link></p>
      )}

      <form className="card flex flex-wrap items-end gap-3 !p-3" action="/tasks">
        {filters.mine && <input type="hidden" name="mine" value="1" />}
        {filters.campaignId && <input type="hidden" name="campaignId" value={filters.campaignId} />}
        <input type="hidden" name="view" value={view} />
        <div><label className="label">بحث</label><input name="q" defaultValue={sp.q} placeholder="العنوان أو BASMA-2026-…" className="input" /></div>
        <div><label className="label">الحالة</label>
          <select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">الكل</option>{WORK_STATUSES.map((s) => <option key={s} value={s}>{WORK_STATUS_LABEL[s]}</option>)}</select></div>
        <div><label className="label">المرحلة</label>
          <select name="stage" defaultValue={sp.stage ?? ""} className="input"><option value="">الكل</option>{Object.entries(AR_STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label">الأولوية</label>
          <select name="priority" defaultValue={sp.priority ?? ""} className="input"><option value="">الكل</option>{PRIORITIES.map((p) => <option key={p} value={p}>{AR_PRIORITY[p]}</option>)}</select></div>
        {showAssignee && !filters.mine && (
          <div><label className="label">المسؤول</label>
            <select name="assigneeId" defaultValue={sp.assigneeId ?? ""} className="input"><option value="">الكل</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        )}
        <div><label className="label">الموعد النهائي</label>
          <select name="due" defaultValue={sp.due ?? ""} className="input"><option value="">الكل</option>{DUE_FILTERS.map((d) => <option key={d} value={d}>{DUE_LABEL[d]}</option>)}</select></div>
        <div><label className="label">الترتيب</label>
          <select name="sort" defaultValue={filters.sort} className="input"><option value="deadline">الموعد النهائي</option><option value="priority">الأولوية</option><option value="created">الأحدث</option></select></div>
        <button className="btn-secondary">تصفية</button>
        <Link href={filters.mine ? "/tasks?mine=1" : "/tasks"} className="pb-2 text-sm text-slate-500 underline">مسح</Link>
      </form>
      {filters.campaignId && <p className="text-sm text-slate-600">مصفاة حسب الحملة · <Link className="text-brand-600 underline" href="/tasks">إزالة</Link></p>}

      {view === "list" ? (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-start text-sm">
            <thead className="border-b bg-slate-50 text-xs text-slate-500">
              <tr><th className="p-3 text-start">المهمة</th><th className="p-3 text-start">الحالة</th><th className="p-3 text-start">المرحلة</th><th className="p-3 text-start">الأولوية</th><th className="p-3 text-start">المسؤول</th><th className="p-3 text-start">الموعد النهائي</th></tr>
            </thead>
            <tbody className="divide-y">
              {items.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">لا توجد مهام مطابقة.</td></tr>}
              {items.map((t) => {
                const late = isLate(t), done = t.checklist.filter((c) => c.done).length;
                return (
                  <tr key={t.id} className={late ? "bg-red-50/40 hover:bg-red-50" : "hover:bg-slate-50"}>
                    <td className="p-3"><Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link>
                      <div className="text-xs text-slate-400">{t.taskCode}{t.brand && ` · ${t.brand.name}`}{t.campaign && ` / ${t.campaign.name}`}{t.checklist.length > 0 && ` · ✓ ${done}/${t.checklist.length}`}{t._count.collaborators > 0 && ` · ${t._count.collaborators} متعاون`}</div></td>
                    <td className="p-3 text-xs">{WORK_STATUS_LABEL[statusOf(t)]}</td>
                    <td className="p-3"><StageBadge s={t.stage} /></td>
                    <td className="p-3"><PriorityBadge p={t.priority} /></td>
                    <td className="p-3">{t.currentAssignee?.name ?? <span className="text-slate-400">غير مسندة</span>}</td>
                    <td className={`p-3 ${late ? "font-medium text-red-600" : ""}`}><bdi>{formatDateTime(t.deadline, env.timezone)}</bdi>{late && " · متأخرة"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {WORK_STATUSES.map((s) => {
            const col = items.filter((t) => statusOf(t) === s);
            return (
              <section key={s} className="rounded-lg bg-slate-100 p-2" aria-label={WORK_STATUS_LABEL[s]}>
                <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-medium">{WORK_STATUS_LABEL[s]}<span className="rounded-full bg-white px-2 text-xs text-slate-500">{col.length}</span></h2>
                <ul className="space-y-2">
                  {col.length === 0 && <li className="px-1 py-3 text-center text-xs text-slate-400">لا توجد مهام</li>}
                  {col.map((t) => {
                    const late = isLate(t), done = t.checklist.filter((c) => c.done).length;
                    return (
                      <li key={t.id} className={`rounded-md border bg-white p-3 text-sm shadow-sm ${late ? "border-red-300" : ""}`}>
                        <Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link>
                        <div className="mt-1 text-xs text-slate-400">{t.taskCode}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-1"><PriorityBadge p={t.priority} /><StageBadge s={t.stage} /></div>
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                          <span>{t.currentAssignee?.name ?? "غير مسندة"}</span>
                          {t.checklist.length > 0 && <span>✓ {done}/{t.checklist.length}</span>}
                        </div>
                        {t.deadline && <div className={`mt-1 text-xs ${late ? "font-medium text-red-600" : "text-slate-500"}`}><bdi>{formatDateTime(t.deadline, env.timezone)}</bdi>{late && " · متأخرة"}</div>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {view === "board" && total > items.length && <p className="text-sm text-amber-700">تُعرض أول {items.length} مهمة من {total}. استخدم المصفاة لتضييق النتائج.</p>}
      {view === "list" && pages > 1 && (
        <div className="flex items-center justify-center gap-4 text-sm">
          {page > 1 && <Link className="underline" href={qs({ page: String(page - 1) })}>→ السابق</Link>}
          <span>صفحة {page} / {pages}</span>
          {page < pages && <Link className="underline" href={qs({ page: String(page + 1) })}>التالي ←</Link>}
        </div>
      )}
    </div>
  );
}
