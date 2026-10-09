import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { createTemplateAction, deleteTemplateAction } from "@/app/actions/templates";
import { BUILTIN_TEMPLATES, baseLabel, requiredLabel, type TemplateDef } from "@/lib/templates";
import { listCustomTemplates } from "@/lib/templates-db";

const DEFAULT_FIELDS = ["objective", "targetAudience", "brief", "cta", "hashtags", "props", "location", "specialNotes", "script"] as const;

function Summary({ t }: { t: TemplateDef }) {
  return (
    <dl className="mt-3 space-y-1 text-xs text-slate-500">
      <div><dt className="inline font-medium text-slate-600">المطلوب: </dt><dd className="inline">{t.required.length ? t.required.map((r) => requiredLabel(t, r)).join("، ") : "—"}</dd></div>
      {t.extra.length > 0 && <div><dt className="inline font-medium text-slate-600">حقول إضافية: </dt><dd className="inline">{t.extra.map((e) => e.label).join("، ")}</dd></div>}
      <div><dt className="inline font-medium text-slate-600">الحقول: </dt><dd className="inline">{t.show.length} من 18</dd></div>
    </dl>
  );
}

export default async function TemplatesPage() {
  const user = await requireUser();
  const manage = can(user.role, "template:manage");
  const customs = await listCustomTemplates(user.organizationId);
  const canCreate = can(user.role, "task:create");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">القوالب</h1>
      <p className="text-sm text-slate-500">القوالب تُنشئ الحقول المناسبة لكل نوع محتوى. القوالب الجاهزة ثابتة، والقوالب المخصصة تضيف نصك الافتتاحي.</p>

      <section className="space-y-3">
        <h2 className="font-medium">القوالب الجاهزة</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {BUILTIN_TEMPLATES.map((t) => (
            <div key={t.key} className="card">
              <div className="flex items-start justify-between gap-2"><h3 className="font-medium">{t.name}</h3>
                {canCreate && <Link href={`/tasks/new?template=${t.key}`} className="text-sm text-brand-600 underline">استخدام</Link>}</div>
              <p className="text-sm text-slate-500">{t.description}</p><Summary t={t} />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">قوالبك</h2>
        {customs.length === 0 && <p className="text-sm text-slate-500">لا توجد قوالب مخصصة بعد.</p>}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {customs.map(({ row, def }) => (
            <div key={row.id} className="card">
              <div className="flex items-start justify-between gap-2"><h3 className="font-medium">{def.name}</h3>
                <div className="flex gap-3 text-sm">
                  {canCreate && <Link href={`/tasks/new?template=${def.key}`} className="text-brand-600 underline">استخدام</Link>}
                  {manage && <form action={deleteTemplateAction}><input type="hidden" name="id" value={row.id} /><button className="text-red-600 underline">حذف</button></form>}
                </div></div>
              <p className="text-sm text-slate-500">{def.description}</p><Summary t={def} />
              {Object.keys(def.defaults).length > 0 && <p className="mt-2 text-xs text-slate-400">يملأ مسبقاً: {Object.keys(def.defaults).map((k) => baseLabel(k as never)).join("، ")}</p>}
            </div>
          ))}
        </div>
      </section>

      {manage && (
        <section className="card">
          <h2 className="mb-1 font-medium">إنشاء قالب مخصص</h2>
          <p className="mb-4 text-sm text-slate-500">اختر قالباً جاهزاً أساساً، ثم أضف النص الذي تبدأ به كل مهمة من هذا النوع. الحقول التي لا يعرضها القالب الأساسي تُتجاهل.</p>
          <ActionForm action={createTemplateAction} submitLabel="حفظ القالب" successMessage="تم حفظ القالب." className="grid gap-4 md:grid-cols-2">
            <Field label="الاسم" name="name"><Input name="name" required maxLength={80} placeholder="ريل تزاج" /></Field>
            <Field label="القالب الأساسي" name="base"><select id="base" name="base" className="input" defaultValue="instagram-reel">{BUILTIN_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></Field>
            <div className="md:col-span-2"><Field label="الوصف" name="description"><Input name="description" maxLength={300} /></Field></div>
            {DEFAULT_FIELDS.map((k) => (
              <div key={k} className={k === "script" || k === "brief" ? "md:col-span-2" : ""}>
                <Field label={`${baseLabel(k)} الافتراضي`} name={`default.${k}`}><textarea id={`default.${k}`} name={`default.${k}`} rows={k === "script" || k === "brief" ? 4 : 2} className="input" /></Field>
              </div>
            ))}
          </ActionForm>
        </section>
      )}
    </div>
  );
}
