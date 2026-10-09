import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { ActionForm } from "@/components/ActionForm";
import { TaskForm } from "@/components/TaskForm";
import { createTaskAction } from "@/app/actions/tasks";
import { BLANK_REF, BUILTIN_TEMPLATES } from "@/lib/templates";
import { listCustomTemplates, resolveTemplateRef } from "@/lib/templates-db";

type SP = { template?: string; campaign?: string; brand?: string };

export default async function NewTask({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("task:create");
  const sp = await searchParams;
  const org = { organizationId: user.organizationId, deletedAt: null };

  // Step 1: choose a template
  if (!sp.template) {
    const customs = await listCustomTemplates(user.organizationId);
    const keep = new URLSearchParams(Object.entries({ campaign: sp.campaign, brand: sp.brand }).filter(([, v]) => v) as [string, string][]);
    const href = (ref: string) => `/tasks/new?${new URLSearchParams({ template: ref, ...Object.fromEntries(keep) })}`;
    const cards = [
      ...BUILTIN_TEMPLATES.map((t) => ({ ref: t.key, name: t.name, description: t.description, tag: "" })),
      ...customs.map((c) => ({ ref: c.def.key, name: c.def.name, description: c.def.description, tag: "مخصص" })),
    ];
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">مهمة جديدة</h1>
        <p className="text-sm text-slate-500">اختر قالباً — يجهّز الحقول المناسبة لنوع المحتوى.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Link key={c.ref} href={href(c.ref)} className="card block transition hover:border-brand-500 hover:shadow">
              <div className="flex items-center justify-between"><h2 className="font-medium">{c.name}</h2>{c.tag && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">{c.tag}</span>}</div>
              <p className="mt-1 text-sm text-slate-500">{c.description}</p>
            </Link>
          ))}
          <Link href={href(BLANK_REF)} className="card block border-dashed transition hover:border-brand-500">
            <h2 className="font-medium">مهمة فارغة</h2><p className="mt-1 text-sm text-slate-500">ابدأ من الصفر بكل الحقول.</p>
          </Link>
        </div>
      </div>
    );
  }

  // Step 2: the form
  const template = await resolveTemplateRef(user.organizationId, sp.template === BLANK_REF ? null : sp.template);
  if (sp.template !== BLANK_REF && !template) notFound();
  const [brands, campaigns, assignees] = await Promise.all([
    db.brand.findMany({ where: org, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.campaign.findMany({ where: org, orderBy: { name: "asc" }, select: { id: true, name: true, brandId: true } }),
    db.user.findMany({
      where: { ...org, status: "ACTIVE", role: { in: ["VIDEOGRAPHER", "PHOTOGRAPHER", "DESIGNER"] } },
      orderBy: { name: "asc" }, select: { id: true, name: true, role: true },
    }),
  ]);
  const campaign = campaigns.find((c) => c.id === sp.campaign);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">مهمة جديدة{template ? ` · ${template.name}` : ""}</h1>
        <Link href="/tasks/new" className="text-sm text-brand-600 underline">تغيير القالب</Link>
      </div>
      <ActionForm action={createTaskAction} submitLabel="إنشاء المهمة" className="space-y-6">
        <TaskForm template={template} templateRef={template?.key} brands={brands} campaigns={campaigns} assignees={assignees}
          preset={{ campaignId: campaign?.id, brandId: campaign?.brandId ?? brands.find((b) => b.id === sp.brand)?.id }} />
      </ActionForm>
    </div>
  );
}
