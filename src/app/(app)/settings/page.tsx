import Link from "next/link";
import { requireUser } from "@/lib/session";
import { PERMISSIONS, ROLE_PERMISSIONS, can } from "@/lib/rbac";
import { env } from "@/lib/env";
import { listBrandsForSettings } from "@/lib/settings";
import { AR_PERMISSION, AR_ROLE } from "@/lib/i18n/ar";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { archiveBrandFromSettingsAction, renameOrganizationAction, restoreBrandAction, saveBrandAction } from "@/app/actions/settings";
import type { Role } from "@prisma/client";

const ROLES = Object.keys(AR_ROLE) as Role[];

export default async function SettingsPage() {
  const user = await requireUser();
  const manageBrands = can(user.role, "campaign:manage");
  const { active, archived } = manageBrands ? await listBrandsForSettings(user) : { active: [], archived: [] };
  const brandFields = (b?: (typeof active)[number]) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="اسم البراند *" name="name"><Input name="name" defaultValue={b?.name} required minLength={2} maxLength={100} /></Field>
      <Field label="رابط إرشادات البراند" name="guidelinesUrl"><Input name="guidelinesUrl" defaultValue={b?.guidelinesUrl ?? ""} dir="ltr" placeholder="https://…" maxLength={1000} /></Field>
    </div>
  );
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">الإعدادات</h1>

      <section className="card space-y-3">
        <h2 className="font-medium">المؤسسة</h2>
        {can(user.role, "org:settings") ? (
          <ActionForm action={renameOrganizationAction} submitLabel="حفظ" successMessage="تم حفظ اسم المؤسسة." className="flex flex-wrap items-start gap-2">
            <input name="name" defaultValue={user.organization.name} className="input !w-72" required minLength={2} maxLength={100} aria-label="اسم المؤسسة" />
          </ActionForm>
        ) : <p className="text-sm">{user.organization.name}</p>}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="label">المنطقة الزمنية</dt><dd dir="ltr" className="text-start">{env.timezone}</dd></div>
          <div><dt className="label">إدارة الأعضاء والأدوار</dt><dd>{can(user.role, "user:manage") ? <Link href="/team" className="text-brand-600 underline">فتح صفحة الفريق</Link> : "للمدير فقط"}</dd></div>
        </dl>
        <p className="text-xs text-slate-400">المنطقة الزمنية وبداية الأسبوع تُضبطان من متغيرات البيئة <code dir="ltr">APP_TIMEZONE</code> و<code dir="ltr">WEEK_START</code> عند النشر.</p>
      </section>

      {manageBrands && (
        <section className="space-y-3">
          <h2 className="font-medium">البراندات</h2>
          <details className="card"><summary className="cursor-pointer text-sm font-medium text-brand-600">+ إضافة براند</summary>
            <ActionForm action={saveBrandAction.bind(null, null)} submitLabel="إضافة" successMessage="تمت إضافة البراند." className="mt-3 space-y-3">{brandFields()}</ActionForm></details>
          {active.length === 0 && <p className="text-sm text-slate-500">لا توجد براندات بعد.</p>}
          {active.map((b) => (
            <details key={b.id} className="card">
              <summary className="flex cursor-pointer items-center justify-between text-sm"><span className="font-medium">{b.name}</span>
                <span className="text-slate-400">{b._count.campaigns} حملة · {b._count.tasks} مهمة</span></summary>
              <ActionForm action={saveBrandAction.bind(null, b.id)} submitLabel="حفظ" successMessage="تم الحفظ." className="mt-3 space-y-3">{brandFields(b)}</ActionForm>
              <div className="mt-3 border-t pt-3">
                {b._count.campaigns > 0
                  ? <p className="text-xs text-slate-500">لا يمكن أرشفة البراند قبل أرشفة حملاته ({b._count.campaigns}).</p>
                  : <ActionForm action={archiveBrandFromSettingsAction.bind(null, b.id)} submitLabel="أرشفة البراند" danger />}
              </div>
            </details>
          ))}
          {archived.length > 0 && (
            <details className="card"><summary className="cursor-pointer text-sm text-slate-600">البراندات المؤرشفة ({archived.length})</summary>
              <ul className="mt-2 divide-y text-sm">
                {archived.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 py-2"><span>{b.name}</span>
                    <ActionForm action={restoreBrandAction.bind(null, b.id)} submitLabel="استعادة" className="flex items-center gap-2" /></li>
                ))}
              </ul></details>
          )}
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="font-medium">الصلاحيات حسب الدور</h2>
        <p className="text-sm text-slate-500">الأدوار ثابتة في النظام. يغيّر المدير دور العضو من صفحة الفريق. دورك الحالي: <b>{AR_ROLE[user.role]}</b>.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead><tr className="border-b text-xs text-slate-500">
              <th className="p-2 text-start">الصلاحية</th>
              {ROLES.map((r) => <th key={r} className={`p-2 text-center ${r === user.role ? "bg-brand-50 text-brand-700" : ""}`}>{AR_ROLE[r]}</th>)}
            </tr></thead>
            <tbody className="divide-y">
              {PERMISSIONS.map((p) => (
                <tr key={p}>
                  <td className="p-2">{AR_PERMISSION[p]}</td>
                  {ROLES.map((r) => {
                    const has = ROLE_PERMISSIONS[r].includes(p);
                    return <td key={r} className={`p-2 text-center ${r === user.role ? "bg-brand-50/50" : ""}`}><span aria-label={has ? "مسموح" : "غير مسموح"} className={has ? "text-green-600" : "text-slate-300"}>{has ? "✓" : "—"}</span></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
