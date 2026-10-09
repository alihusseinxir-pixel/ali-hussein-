import Link from "next/link";
import { redirect } from "next/navigation";
import type { TaskStage } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { visibleTasksWhere } from "@/lib/tasks";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/datetime";
import { StageBadge, PriorityBadge } from "@/components/Badges";

const STAGES: TaskStage[] = ["PRODUCTION_REVIEW", "EDITING_REVIEW", "INTERNAL_APPROVAL", "SOCIAL_APPROVAL"];

export default async function ApprovalsPage() {
  const user = await requireUser();
  if (!can(user.role, "approval:internal") && !can(user.role, "approval:final")) redirect("/dashboard?denied=1");
  const tasks = await db.task.findMany({
    where: { AND: [visibleTasksWhere(user), { stage: { in: STAGES } }] },
    include: { currentAssignee: { select: { id: true, name: true } }, brand: { select: { name: true } } },
    orderBy: [{ deadline: { sort: "asc", nulls: "last" } }],
  });
  const mine = tasks.filter((t) => t.currentAssigneeId === user.id);
  const others = tasks.filter((t) => t.currentAssigneeId !== user.id);
  const Table = ({ rows, empty }: { rows: typeof tasks; empty: string }) => (
    <div className="card overflow-x-auto !p-0">
      <table className="w-full text-start text-sm"><tbody className="divide-y">
        {rows.length === 0 && <tr><td className="p-6 text-center text-slate-500">{empty}</td></tr>}
        {rows.map((t) => (
          <tr key={t.id} className="hover:bg-slate-50">
            <td className="p-3"><Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link><div className="text-xs text-slate-400">{t.taskCode}{t.brand && ` · ${t.brand.name}`}</div></td>
            <td className="p-3"><StageBadge s={t.stage} /></td><td className="p-3"><PriorityBadge p={t.priority} /></td>
            <td className="p-3">{t.currentAssignee?.name ?? "—"}</td><td className="p-3">{formatDateTime(t.deadline, env.timezone)}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">الموافقات</h1>
      <section className="space-y-2"><h2 className="font-medium">بانتظارك ({mine.length})</h2><Table rows={mine} empty="لا شيء بانتظار موافقتك." /></section>
      {can(user.role, "task:view:all") && <section className="space-y-2"><h2 className="font-medium">بانتظار آخرين ({others.length})</h2><Table rows={others} empty="لا توجد مهام أخرى قيد المراجعة." /></section>}
    </div>
  );
}
