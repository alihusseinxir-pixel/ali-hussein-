import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/datetime";
import { getShoot } from "@/lib/shoots";
import { PHASES, PHASE_LABEL } from "@/lib/shoot-checks";
import { AR_SHOOT_STATUS } from "@/lib/i18n/ar";
import { ActionForm } from "@/components/ActionForm";
import { ChecklistItem } from "@/components/ChecklistItem";
import { addChecklistItemAction, deleteShootAction, setShootStatusAction } from "@/app/actions/shoots";

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => children ? <div><dt className="label">{k}</dt><dd className="whitespace-pre-wrap text-sm">{children}</dd></div> : null;

export default async function ShootPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const s = await getShoot(user, id);
  if (!s) notFound();
  const tz = env.timezone;
  const open = s.status === "PLANNED";
  return (
    <div className="space-y-6">
      <header className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/shoots" className="text-sm text-brand-600 underline">← الجلسات</Link>
            <h1 className="mt-1 text-2xl font-semibold">{s.title}</h1>
            <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs">{AR_SHOOT_STATUS[s.status]}</span>
          </div>
          {s.canManage && (
            <div className="flex flex-wrap gap-2">
              {open && <Link href={`/shoots/${id}/edit`} className="btn-secondary">تعديل</Link>}
              {open && <form action={setShootStatusAction.bind(null, id, "COMPLETED")}><button className="btn">تم التصوير</button></form>}
              {open && <form action={setShootStatusAction.bind(null, id, "CANCELLED")}><button className="btn-secondary">إلغاء الجلسة</button></form>}
              <form action={deleteShootAction.bind(null, id)}><button className="btn-secondary text-red-600">حذف</button></form>
            </div>
          )}
        </div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Row k="البداية"><bdi dir="ltr">{formatDateTime(s.startsAt, tz)}</bdi></Row>
          <Row k="النهاية"><bdi dir="ltr">{formatDateTime(s.endsAt, tz)}</bdi></Row>
          <Row k="وقت الحضور">{s.callTime && <bdi dir="ltr">{formatDateTime(s.callTime, tz)}</bdi>}</Row>
          <Row k="الميزانية">{s.budget != null && Number(s.budget).toLocaleString("ar", { minimumFractionDigits: 2 })}</Row>
        </dl>
      </header>

      {s.warnings.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4" role="alert">
          <h2 className="mb-2 font-medium text-amber-900">تنبيهات ({s.warnings.length})</h2>
          <ul className="list-disc space-y-1 ps-5 text-sm text-amber-900">{s.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </section>
      )}

      <section className="card grid gap-5 md:grid-cols-2">
        <h2 className="font-medium md:col-span-2">المكان والفريق</h2>
        <Row k="اللوكيشن">{s.location && <>{s.location.name}{s.location.address && <><br />{s.location.address}</>}{s.location.mapUrl && <><br /><a className="text-brand-600 underline" href={s.location.mapUrl} target="_blank" rel="noopener noreferrer">فتح الخريطة</a></>}</>}</Row>
        <Row k="المصور الفوتوغرافي">{s.photographer?.name}</Row>
        <Row k="مصور الفيديو">{s.videographer?.name}</Row>
        <Row k="المخرج / المنتج">{s.director?.name}</Row>
        {s.talents.length > 0 && (
          <div className="md:col-span-2"><div className="label">المودلز</div>
            <ul className="text-sm">{s.talents.map(({ talent: t }) => <li key={t.id}>{t.name}{t.phone && <span className="text-slate-500" dir="ltr"> · {t.phone}</span>}{t.email && <span className="text-slate-500" dir="ltr"> · {t.email}</span>}{t.notes && <span className="text-slate-500"> — {t.notes}</span>}</li>)}</ul></div>
        )}
        {s.contents.length > 0 && (
          <div className="md:col-span-2"><div className="label">المحتوى المرتبط</div>
            <ul className="text-sm">{s.contents.map(({ task: t }) => <li key={t.id}><Link href={`/tasks/${t.id}`} className="text-brand-600 underline">{t.taskCode}</Link> {t.title}</li>)}</ul></div>
        )}
      </section>

      {(s.requiredItems || s.shotList || s.prepNotes) && (
        <section className="card grid gap-5">
          <h2 className="font-medium">تفاصيل التنفيذ</h2>
          <Row k="المنتجات والإكسسوارات والأزياء">{s.requiredItems}</Row>
          <Row k="قائمة اللقطات">{s.shotList}</Row>
          <Row k="ملاحظات التحضير">{s.prepNotes}</Row>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {PHASES.map((phase) => {
          const items = s.checklist.filter((c) => c.phase === phase);
          return (
            <section key={phase} className="card">
              <h2 className="mb-2 font-medium">{PHASE_LABEL[phase]} <span className="text-xs text-slate-400">{items.filter((i) => i.done).length}/{items.length}</span></h2>
              <ul className="divide-y">
                {items.map((c) => <ChecklistItem key={c.id} shootId={id} id={c.id} label={c.label} done={c.done} canCheck={s.canCheck} canRemove={s.canManage} />)}
              </ul>
              {s.canManage && (
                <ActionForm action={addChecklistItemAction.bind(null, id, phase)} submitLabel="إضافة" className="mt-3 flex items-start gap-2">
                  <input name="label" className="input" placeholder="عنصر جديد" maxLength={300} required aria-label={`عنصر جديد في ${PHASE_LABEL[phase]}`} />
                </ActionForm>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
