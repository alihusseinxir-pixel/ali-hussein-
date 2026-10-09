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
      <div><dt className="inline font-medium text-slate-600">Required: </dt><dd className="inline">{t.required.length ? t.required.map((r) => requiredLabel(t, r)).join(", ") : "—"}</dd></div>
      {t.extra.length > 0 && <div><dt className="inline font-medium text-slate-600">Extra fields: </dt><dd className="inline">{t.extra.map((e) => e.label).join(", ")}</dd></div>}
      <div><dt className="inline font-medium text-slate-600">Fields: </dt><dd className="inline">{t.show.length} of 18</dd></div>
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
      <h1 className="text-2xl font-semibold">Templates</h1>
      <p className="text-sm text-slate-500">Templates generate the right fields for each content type. Built-in templates are fixed; custom templates add your own starting text.</p>

      <section className="space-y-3">
        <h2 className="font-medium">Built-in</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {BUILTIN_TEMPLATES.map((t) => (
            <div key={t.key} className="card">
              <div className="flex items-start justify-between gap-2"><h3 className="font-medium">{t.name}</h3>
                {canCreate && <Link href={`/tasks/new?template=${t.key}`} className="text-sm text-brand-600 underline">Use</Link>}</div>
              <p className="text-sm text-slate-500">{t.description}</p><Summary t={t} />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Your templates</h2>
        {customs.length === 0 && <p className="text-sm text-slate-500">No custom templates yet.</p>}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {customs.map(({ row, def }) => (
            <div key={row.id} className="card">
              <div className="flex items-start justify-between gap-2"><h3 className="font-medium">{def.name}</h3>
                <div className="flex gap-3 text-sm">
                  {canCreate && <Link href={`/tasks/new?template=${def.key}`} className="text-brand-600 underline">Use</Link>}
                  {manage && <form action={deleteTemplateAction}><input type="hidden" name="id" value={row.id} /><button className="text-red-600 underline">Delete</button></form>}
                </div></div>
              <p className="text-sm text-slate-500">{def.description}</p><Summary t={def} />
              {Object.keys(def.defaults).length > 0 && <p className="mt-2 text-xs text-slate-400">Pre-fills: {Object.keys(def.defaults).map((k) => baseLabel(k as never)).join(", ")}</p>}
            </div>
          ))}
        </div>
      </section>

      {manage && (
        <section className="card">
          <h2 className="mb-1 font-medium">Create a custom template</h2>
          <p className="mb-4 text-sm text-slate-500">Pick a built-in as the base, then add the text every task of this kind should start with. Fields the base template does not show are ignored.</p>
          <ActionForm action={createTemplateAction} submitLabel="Save template" successMessage="Template saved." className="grid gap-4 md:grid-cols-2">
            <Field label="Name" name="name"><Input name="name" required maxLength={80} placeholder="Tazaj Reel" /></Field>
            <Field label="Base template" name="base"><select id="base" name="base" className="input" defaultValue="instagram-reel">{BUILTIN_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></Field>
            <div className="md:col-span-2"><Field label="Description" name="description"><Input name="description" maxLength={300} /></Field></div>
            {DEFAULT_FIELDS.map((k) => (
              <div key={k} className={k === "script" || k === "brief" ? "md:col-span-2" : ""}>
                <Field label={`Default ${baseLabel(k).toLowerCase()}`} name={`default.${k}`}><textarea id={`default.${k}`} name={`default.${k}`} rows={k === "script" || k === "brief" ? 4 : 2} className="input" /></Field>
              </div>
            ))}
          </ActionForm>
        </section>
      )}
    </div>
  );
}
