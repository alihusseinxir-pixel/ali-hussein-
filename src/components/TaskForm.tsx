import type { Role, Task } from "@prisma/client";
import { Field, Input } from "./Field";
import { CONTENT_TYPES, PLATFORMS, PRIORITIES } from "@/lib/task-schema";
import { toLocalInput } from "@/lib/datetime";
import { env } from "@/lib/env";
import { ROLE_LABELS } from "@/lib/rbac";
import { baseLabel, visibleFields, type BaseField, type TemplateDef } from "@/lib/templates";

const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const LONG = new Set<BaseField>(["consumerInsight", "keyMessage", "caption", "brief", "script", "references", "models", "props", "specialNotes"]);
const CONTENT_KEYS: BaseField[] = ["objective", "targetAudience", "contentPillar", "consumerInsight", "hook", "keyMessage", "cta", "caption", "hashtags", "references", "brief"];
const PRODUCTION_KEYS: BaseField[] = ["models", "props", "location", "product", "specialNotes"];
const DATE_KEYS: BaseField[] = ["shootingAt", "publishAt", "startDate"];

export function TaskForm({
  task, template, templateRef, brands, campaigns, assignees, preset,
}: {
  task?: Task;
  template: TemplateDef | null;
  templateRef?: string; // new tasks only: the reference stored on the task
  brands: { id: string; name: string }[];
  campaigns: { id: string; name: string; brandId: string }[];
  assignees?: { id: string; name: string; role: Role }[]; // omitted on edit
  preset?: { brandId?: string; campaignId?: string };
}) {
  const tz = env.timezone;
  const dt = (d: Date | null | undefined) => toLocalInput(d, tz);
  const t = (task ?? {}) as Partial<Task>;
  const extraValues = ((task?.extra as Record<string, string> | null) ?? {}) as Record<string, string>;
  const show = new Set(visibleFields(template, t as Partial<Record<BaseField, unknown>>));
  const req = (k: string) => !!template?.required.includes(k as never);
  const val = (k: BaseField) => (task ? ((t[k] as string | null) ?? "") : template?.defaults[k] ?? "");
  const select = "input";

  const textField = (k: BaseField, rows = 3) => (
    <div key={k} className={LONG.has(k) ? "md:col-span-2" : ""}>
      <Field label={`${baseLabel(k)}${req(k) ? " *" : ""}`} name={k}>
        {LONG.has(k)
          ? <textarea id={k} name={k} rows={rows} defaultValue={val(k)} required={req(k)} className="input" />
          : <Input name={k} defaultValue={val(k)} required={req(k)} />}
      </Field>
    </div>
  );
  const dateField = (k: BaseField) => (
    <Field key={k} label={`${baseLabel(k)}${req(k) ? " *" : ""}`} name={k}><Input name={k} type="datetime-local" defaultValue={dt(t[k as "shootingAt"] as Date | null)} required={req(k)} /></Field>
  );
  const contentKeys = CONTENT_KEYS.filter((k) => show.has(k));
  const productionKeys = PRODUCTION_KEYS.filter((k) => show.has(k));
  const dateKeys = DATE_KEYS.filter((k) => show.has(k));
  const lockedType = template?.contentType ?? t.contentType;

  return (
    <div className="space-y-6">
      {templateRef && <input type="hidden" name="templateRef" value={templateRef} />}
      <section className="card grid gap-4 md:grid-cols-2">
        <h2 className="flex items-center gap-2 font-medium md:col-span-2">Basic information
          {template && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Template: {template.name}</span>}</h2>
        <div className="md:col-span-2"><Field label="Task name *" name="title"><Input name="title" defaultValue={t.title} required maxLength={200} placeholder="Reel – Tazaj × Match vibes" /></Field></div>
        <Field label="Content type" name="contentType">
          {template ? (
            <>
              <input type="hidden" name="contentType" value={template.contentType} />
              <p className="input bg-slate-50 text-slate-600">{pretty(template.contentType)}</p>
            </>
          ) : (
            <select id="contentType" name="contentType" defaultValue={lockedType ?? "REEL"} className={select}>{CONTENT_TYPES.map((c) => <option key={c} value={c}>{pretty(c)}</option>)}</select>
          )}
        </Field>
        <Field label="Platform" name="platform"><select id="platform" name="platform" defaultValue={t.platform ?? template?.platform ?? ""} className={select}><option value="">—</option>{PLATFORMS.map((c) => <option key={c} value={c}>{pretty(c)}</option>)}</select></Field>
        <Field label="Brand" name="brandId"><select id="brandId" name="brandId" defaultValue={t.brandId ?? preset?.brandId ?? ""} className={select}><option value="">—</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Campaign" name="campaignId"><select id="campaignId" name="campaignId" defaultValue={t.campaignId ?? preset?.campaignId ?? ""} className={select}><option value="">—</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{brands.find((b) => b.id === c.brandId)?.name} / {c.name}</option>)}</select></Field>
        <Field label="Priority" name="priority"><select id="priority" name="priority" defaultValue={t.priority ?? "MEDIUM"} className={select}>{PRIORITIES.map((p) => <option key={p} value={p}>{pretty(p)}</option>)}</select></Field>
        {assignees && (
          <Field label="Assign to" name="assigneeId" hint="Must match the content type (e.g. Reel → Videographer)">
            <select id="assigneeId" name="assigneeId" className={select} defaultValue=""><option value="">Unassigned (stays in Brief)</option>
              {assignees.map((u) => <option key={u.id} value={u.id}>{u.name} — {ROLE_LABELS[u.role]}</option>)}</select>
          </Field>
        )}
      </section>

      {contentKeys.length > 0 && <section className="card grid gap-4 md:grid-cols-2"><h2 className="font-medium md:col-span-2">Content details</h2>{contentKeys.map((k) => textField(k))}</section>}

      {template && template.extra.length > 0 && (
        <section className="card grid gap-4 md:grid-cols-2">
          <h2 className="font-medium md:col-span-2">{template.name} details</h2>
          {template.extra.map((f) => {
            const name = `extra.${f.key}`;
            const required = req(name);
            return (
              <div key={f.key} className={f.textarea ? "md:col-span-2" : ""}>
                <Field label={`${f.label}${required ? " *" : ""}`} name={name}>
                  {f.textarea
                    ? <textarea id={name} name={name} rows={3} defaultValue={extraValues[f.key] ?? ""} placeholder={f.placeholder} required={required} className="input" />
                    : <Input name={name} defaultValue={extraValues[f.key] ?? ""} placeholder={f.placeholder} required={required} />}
                </Field>
              </div>
            );
          })}
        </section>
      )}

      <section className="card grid gap-4 md:grid-cols-2">
        <h2 className="font-medium md:col-span-2">{show.has("script") || productionKeys.length ? "Production details" : "Schedule"}</h2>
        {show.has("script") && (
          <div className="md:col-span-2"><Field label={`${baseLabel("script")}${req("script") ? " *" : ""}`} name="script">
            <textarea id="script" name="script" rows={8} defaultValue={val("script")} required={req("script")} className="input font-mono" placeholder={"SCENE 01 – …\nSCENE 02 – …"} /></Field></div>
        )}
        {productionKeys.map((k) => textField(k, 2))}
        {dateKeys.map(dateField)}
        <Field label="Deadline" name="deadline" hint={`Times are in ${tz}`}><Input name="deadline" type="datetime-local" defaultValue={dt(t.deadline)} /></Field>
      </section>
      {!task && (
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="allowDuplicate" value="1" /> السماح بالتكرار (إنشاء مهمة بنفس اسم مهمة مفتوحة في نفس الحملة)</label>
      )}
    </div>
  );
}
