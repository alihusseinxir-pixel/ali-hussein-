import { Field, Input } from "./Field";
import { toLocalInput } from "@/lib/datetime";
import { env } from "@/lib/env";
import type { ShootSession } from "@prisma/client";

interface Opt { id: string; name: string }
export function ShootForm({ shoot, locations, photographers, videographers, directors, talents, tasks, chosenTalents = [], chosenTasks = [] }: {
  shoot?: ShootSession; locations: Opt[]; photographers: Opt[]; videographers: Opt[]; directors: Opt[]; talents: (Opt & { phone: string | null })[];
  tasks: { id: string; taskCode: string; title: string }[]; chosenTalents?: string[]; chosenTasks?: string[];
}) {
  const tz = env.timezone, dt = (d: Date | null | undefined) => toLocalInput(d, tz);
  const sel = (name: string, label: string, opts: Opt[], value?: string | null) => (
    <Field label={label} name={name}>
      <select id={name} name={name} defaultValue={value ?? ""} className="input"><option value="">—</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
    </Field>
  );
  const area = (name: string, label: string, value: string | null | undefined, rows = 3, hint?: string) => (
    <div className="md:col-span-2"><Field label={label} name={name} hint={hint}><textarea id={name} name={name} rows={rows} defaultValue={value ?? ""} className="input" /></Field></div>
  );
  return (
    <div className="space-y-6">
      <section className="card grid gap-4 md:grid-cols-2">
        <h2 className="font-medium md:col-span-2">الموعد والمكان</h2>
        <div className="md:col-span-2"><Field label="عنوان الجلسة *" name="title"><Input name="title" defaultValue={shoot?.title} required minLength={3} maxLength={200} placeholder="تصوير ريلز المنتج الجديد" /></Field></div>
        <Field label="البداية *" name="startsAt" hint={`التوقيت: ${tz}`}><Input name="startsAt" type="datetime-local" defaultValue={dt(shoot?.startsAt)} required /></Field>
        <Field label="النهاية *" name="endsAt"><Input name="endsAt" type="datetime-local" defaultValue={dt(shoot?.endsAt)} required /></Field>
        <Field label="وقت الحضور (Call time)" name="callTime"><Input name="callTime" type="datetime-local" defaultValue={dt(shoot?.callTime)} /></Field>
        {sel("locationId", "اللوكيشن", locations, shoot?.locationId)}
      </section>

      <section className="card grid gap-4 md:grid-cols-3">
        <h2 className="font-medium md:col-span-3">فريق التصوير</h2>
        {sel("photographerId", "المصور الفوتوغرافي", photographers, shoot?.photographerId)}
        {sel("videographerId", "مصور الفيديو", videographers, shoot?.videographerId)}
        {sel("directorId", "المخرج / المنتج (اختياري)", directors, shoot?.directorId)}
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">المودلز</h2>
        {talents.length === 0 ? <p className="text-sm text-slate-500">لا يوجد مودلز بعد. أضفهم من صفحة الموارد.</p> : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {talents.map((t) => (
              <label key={t.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <input type="checkbox" name="talentIds" value={t.id} defaultChecked={chosenTalents.includes(t.id)} />{t.name}{t.phone && <span className="text-xs text-slate-400" dir="ltr">{t.phone}</span>}
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">المحتوى المرتبط</h2>
        {tasks.length === 0 ? <p className="text-sm text-slate-500">لا توجد مهام متاحة للربط.</p> : (
          <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
            {tasks.map((t) => (
              <label key={t.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <input type="checkbox" name="taskIds" value={t.id} defaultChecked={chosenTasks.includes(t.id)} /><span className="text-xs text-slate-400">{t.taskCode}</span>{t.title}
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="card grid gap-4 md:grid-cols-2">
        <h2 className="font-medium md:col-span-2">التفاصيل</h2>
        {area("requiredItems", "المنتجات والإكسسوارات والأزياء المطلوبة", shoot?.requiredItems)}
        {area("shotList", "قائمة اللقطات", shoot?.shotList, 6)}
        {area("prepNotes", "ملاحظات التحضير", shoot?.prepNotes)}
        <Field label="الميزانية (اختياري)" name="budget"><Input name="budget" type="number" min={0} step="0.01" defaultValue={shoot?.budget ? String(shoot.budget) : ""} /></Field>
      </section>
    </div>
  );
}
