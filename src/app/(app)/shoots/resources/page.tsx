import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { listLocations, listTalents } from "@/lib/shoot-resources";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { archiveLocationAction, archiveTalentAction, saveLocationAction, saveTalentAction } from "@/app/actions/shoots";

export default async function ResourcesPage() {
  const user = await requirePermission("shoot:manage");
  const [talents, locations] = await Promise.all([listTalents(user), listLocations(user)]);
  const talentFields = (t?: (typeof talents)[number]) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="الاسم *" name="name"><Input name="name" defaultValue={t?.name} required minLength={2} maxLength={120} /></Field>
      <Field label="الهاتف" name="phone"><Input name="phone" defaultValue={t?.phone ?? ""} dir="ltr" maxLength={40} /></Field>
      <Field label="البريد الإلكتروني" name="email"><Input name="email" type="email" defaultValue={t?.email ?? ""} dir="ltr" /></Field>
      <Field label="ملاحظات" name="notes"><Input name="notes" defaultValue={t?.notes ?? ""} maxLength={1000} /></Field>
    </div>
  );
  const locationFields = (l?: (typeof locations)[number]) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="الاسم *" name="name"><Input name="name" defaultValue={l?.name} required minLength={2} maxLength={120} /></Field>
      <Field label="العنوان" name="address"><Input name="address" defaultValue={l?.address ?? ""} maxLength={500} /></Field>
      <Field label="رابط الخريطة" name="mapUrl"><Input name="mapUrl" defaultValue={l?.mapUrl ?? ""} dir="ltr" placeholder="https://maps…" maxLength={1000} /></Field>
      <Field label="ملاحظات" name="notes"><Input name="notes" defaultValue={l?.notes ?? ""} maxLength={1000} /></Field>
    </div>
  );
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">المودلز واللوكيشنات</h1><Link href="/shoots" className="text-sm text-brand-600 underline">← جلسات التصوير</Link></div>

      <section className="space-y-3">
        <h2 className="font-medium">المودلز</h2>
        <details className="card"><summary className="cursor-pointer text-sm font-medium text-brand-600">+ إضافة مودل</summary>
          <ActionForm action={saveTalentAction.bind(null, null)} submitLabel="إضافة" successMessage="تمت الإضافة." className="mt-3 space-y-3">{talentFields()}</ActionForm></details>
        {talents.length === 0 && <p className="text-sm text-slate-500">لا يوجد مودلز بعد.</p>}
        {talents.map((t) => (
          <details key={t.id} className="card"><summary className="flex cursor-pointer items-center justify-between text-sm"><span className="font-medium">{t.name}</span><span className="text-slate-400" dir="ltr">{t.phone}</span></summary>
            <ActionForm action={saveTalentAction.bind(null, t.id)} submitLabel="حفظ" successMessage="تم الحفظ." className="mt-3 space-y-3">{talentFields(t)}</ActionForm>
            <form action={archiveTalentAction.bind(null, t.id)} className="mt-2"><button className="text-sm text-red-600 underline">أرشفة</button></form></details>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">اللوكيشنات</h2>
        <details className="card"><summary className="cursor-pointer text-sm font-medium text-brand-600">+ إضافة لوكيشن</summary>
          <ActionForm action={saveLocationAction.bind(null, null)} submitLabel="إضافة" successMessage="تمت الإضافة." className="mt-3 space-y-3">{locationFields()}</ActionForm></details>
        {locations.length === 0 && <p className="text-sm text-slate-500">لا توجد لوكيشنات بعد.</p>}
        {locations.map((l) => (
          <details key={l.id} className="card"><summary className="flex cursor-pointer items-center justify-between text-sm"><span className="font-medium">{l.name}</span><span className="text-slate-400">{l.address}</span></summary>
            <ActionForm action={saveLocationAction.bind(null, l.id)} submitLabel="حفظ" successMessage="تم الحفظ." className="mt-3 space-y-3">{locationFields(l)}</ActionForm>
            <form action={archiveLocationAction.bind(null, l.id)} className="mt-2"><button className="text-sm text-red-600 underline">أرشفة</button></form></details>
        ))}
      </section>
    </div>
  );
}
