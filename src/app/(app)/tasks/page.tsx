import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listTasks, type TaskFilters } from "@/lib/tasks";
import { can } from "@/lib/rbac";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/datetime";
import { PRIORITIES } from "@/lib/task-schema";
import { STAGE_LABELS } from "@/lib/workflow";
import { PriorityBadge, StageBadge } from "@/components/Badges";
import type { Priority, TaskStage } from "@prisma/client";

type SP = Record<string, string | undefined>;

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filters: TaskFilters = {
    q: sp.q?.trim() || undefined,
    stage: sp.stage && sp.stage in STAGE_LABELS ? (sp.stage as TaskStage) : undefined,
    priority: sp.priority && (PRIORITIES as readonly string[]).includes(sp.priority) ? (sp.priority as Priority) : undefined,
    campaignId: sp.campaignId || undefined,
    mine: sp.mine === "1",
    overdue: sp.overdue === "1",
    sort: sp.sort === "created" || sp.sort === "priority" ? sp.sort : "deadline",
    page: Number(sp.page) || 1,
  };
  const { items, total, page, pages } = await listTasks(user, filters);
  const qs = (over: SP) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...over }).filter(([, v]) => v) as [string, string][]);
    return `/tasks?${p}`;
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{filters.mine ? "My Tasks" : "Tasks"} <span className="text-base font-normal text-slate-400">({total})</span></h1>
        {can(user.role, "task:create") && <Link href="/tasks/new" className="btn">+ Create Task</Link>}
      </div>
      <form className="card flex flex-wrap items-end gap-3 !p-3" action="/tasks">
        {filters.mine && <input type="hidden" name="mine" value="1" />}
        {filters.campaignId && <input type="hidden" name="campaignId" value={filters.campaignId} />}
        <div><label className="label">Search</label><input name="q" defaultValue={sp.q} placeholder="Title or BASMA-2026-…" className="input" /></div>
        <div><label className="label">Stage</label>
          <select name="stage" defaultValue={sp.stage ?? ""} className="input"><option value="">All</option>{Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label">Priority</label>
          <select name="priority" defaultValue={sp.priority ?? ""} className="input"><option value="">All</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
        <div><label className="label">Sort</label>
          <select name="sort" defaultValue={filters.sort} className="input"><option value="deadline">Deadline</option><option value="priority">Priority</option><option value="created">Newest</option></select></div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="overdue" value="1" defaultChecked={filters.overdue} /> Overdue only</label>
        <button className="btn-secondary">Filter</button>
      </form>
      {filters.campaignId && <p className="text-sm text-slate-600">Filtered by campaign · <Link className="text-brand-600 underline" href="/tasks">clear</Link></p>}
      <div className="card overflow-x-auto !p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th className="p-3">Task</th><th className="p-3">Stage</th><th className="p-3">Priority</th><th className="p-3">Owner</th><th className="p-3">Deadline</th></tr>
          </thead>
          <tbody className="divide-y">
            {items.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-500">No tasks found.</td></tr>}
            {items.map((t) => {
              const late = t.deadline && t.deadline < new Date() && !["PUBLISHED", "COMPLETED"].includes(t.stage);
              return (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="p-3"><Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link>
                    <div className="text-xs text-slate-400">{t.taskCode}{t.brand && ` · ${t.brand.name}`}{t.campaign && ` / ${t.campaign.name}`}</div></td>
                  <td className="p-3"><StageBadge s={t.stage} /></td>
                  <td className="p-3"><PriorityBadge p={t.priority} /></td>
                  <td className="p-3">{t.currentAssignee?.name ?? <span className="text-slate-400">Unassigned</span>}</td>
                  <td className={`p-3 ${late ? "font-medium text-red-600" : ""}`}>{formatDateTime(t.deadline, env.timezone)}{late && " · overdue"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-4 text-sm">
          {page > 1 && <Link className="underline" href={qs({ page: String(page - 1) })}>← Previous</Link>}
          <span>Page {page} / {pages}</span>
          {page < pages && <Link className="underline" href={qs({ page: String(page + 1) })}>Next →</Link>}
        </div>
      )}
    </div>
  );
}
