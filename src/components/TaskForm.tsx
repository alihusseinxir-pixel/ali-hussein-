import type { Task } from "@prisma/client";
import { Field, Input } from "./Field";
import { CONTENT_TYPES, PLATFORMS, PRIORITIES, TASK_FIELD_LABELS } from "@/lib/task-schema";
import { toLocalInput } from "@/lib/datetime";
import { env } from "@/lib/env";
import { ROLE_LABELS } from "@/lib/rbac";
import type { Role } from "@prisma/client";

const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const LONG = new Set(["consumerInsight", "keyMessage", "caption", "brief", "script", "references", "models", "props", "specialNotes"]);

export function TaskForm({
  task, brands, campaigns, assignees,
}: {
  task?: Task;
  brands: { id: string; name: string }[];
  campaigns: { id: string; name: string; brandId: string }[];
  assignees?: { id: string; name: string; role: Role }[]; // omitted on edit
}) {
  const tz = env.timezone;
  const dt = (d: Date | null | undefined) => toLocalInput(d, tz);
  const t = (task ?? {}) as Partial<Task>;
  const select = "input";
  return (
    <div className="space-y-6">
      <section className="card grid gap-4 md:grid-cols-2">
        <h2 className="font-medium md:col-span-2">Basic information</h2>
        <div className="md:col-span-2"><Field label="Task name" name="title"><Input name="title" defaultValue={t.title} required maxLength={200} placeholder="Reel – Tazaj × Match vibes" /></Field></div>
        <Field label="Content type" name="contentType"><select id="contentType" name="contentType" defaultValue={t.contentType ?? "REEL"} className={select}>{CONTENT_TYPES.map((c) => <option key={c} value={c}>{pretty(c)}</option>)}</select></Field>
        <Field label="Platform" name="platform"><select id="platform" name="platform" defaultValue={t.platform ?? ""} className={select}><option value="">—</option>{PLATFORMS.map((c) => <option key={c} value={c}>{pretty(c)}</option>)}</select></Field>
        <Field label="Brand" name="brandId"><select id="brandId" name="brandId" defaultValue={t.brandId ?? ""} className={select}><option value="">—</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Campaign" name="campaignId"><select id="campaignId" name="campaignId" defaultValue={t.campaignId ?? ""} className={select}><option value="">—</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{brands.find((b) => b.id === c.brandId)?.name} / {c.name}</option>)}</select></Field>
        <Field label="Priority" name="priority"><select id="priority" name="priority" defaultValue={t.priority ?? "MEDIUM"} className={select}>{PRIORITIES.map((p) => <option key={p} value={p}>{pretty(p)}</option>)}</select></Field>
        {assignees && (
          <Field label="Assign to" name="assigneeId" hint="Must match the content type (e.g. Reel → Videographer)">
            <select id="assigneeId" name="assigneeId" className={select} defaultValue=""><option value="">Unassigned (stays in Brief)</option>
              {assignees.map((u) => <option key={u.id} value={u.id}>{u.name} — {ROLE_LABELS[u.role]}</option>)}</select>
          </Field>
        )}
      </section>

      <section className="card grid gap-4 md:grid-cols-2">
        <h2 className="font-medium md:col-span-2">Content details</h2>
        {(["objective", "targetAudience", "consumerInsight", "keyMessage", "cta", "caption", "hashtags", "references", "brief"] as const).map((k) => (
          <div key={k} className={LONG.has(k) ? "md:col-span-2" : ""}>
            <Field label={TASK_FIELD_LABELS[k]} name={k}>
              {LONG.has(k) ? <textarea id={k} name={k} rows={3} defaultValue={t[k] ?? ""} className="input" /> : <Input name={k} defaultValue={t[k] ?? ""} />}
            </Field>
          </div>
        ))}
      </section>

      <section className="card grid gap-4 md:grid-cols-2">
        <h2 className="font-medium md:col-span-2">Production details</h2>
        <div className="md:col-span-2"><Field label="Script" name="script"><textarea id="script" name="script" rows={8} defaultValue={t.script ?? ""} className="input font-mono" placeholder={"SCENE 01 – …\nSCENE 02 – …"} /></Field></div>
        {(["models", "props", "location", "product", "specialNotes"] as const).map((k) => (
          <div key={k} className={LONG.has(k) ? "md:col-span-2" : ""}>
            <Field label={TASK_FIELD_LABELS[k]} name={k}>
              {LONG.has(k) ? <textarea id={k} name={k} rows={2} defaultValue={t[k] ?? ""} className="input" /> : <Input name={k} defaultValue={t[k] ?? ""} />}
            </Field>
          </div>
        ))}
        <Field label="Shooting date & time" name="shootingAt"><Input name="shootingAt" type="datetime-local" defaultValue={dt(t.shootingAt)} /></Field>
        <Field label="Publishing date & time" name="publishAt"><Input name="publishAt" type="datetime-local" defaultValue={dt(t.publishAt)} /></Field>
        <Field label="Start date" name="startDate"><Input name="startDate" type="datetime-local" defaultValue={dt(t.startDate)} /></Field>
        <Field label="Deadline" name="deadline" hint={`Times are in ${tz}`}><Input name="deadline" type="datetime-local" defaultValue={dt(t.deadline)} /></Field>
      </section>
    </div>
  );
}
