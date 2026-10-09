"use client";
import { useState, useTransition } from "react";
import { createBriefShareAction, revokeBriefSharesAction } from "@/app/actions/brief";

export function BriefPanel({ taskId, canShare }: { taskId: string; canShare: boolean }) {
  const [days, setDays] = useState(7);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const base = `/api/tasks/${taskId}/brief`;

  const create = () => start(async () => {
    setMsg(null);
    const r = await createBriefShareAction(taskId, days);
    if (r.error || !r.url) { setMsg(r.error ?? "تعذّر إنشاء الرابط"); return; }
    setLink({ url: r.url, expiresAt: r.expiresAt! });
  });
  const revoke = () => start(async () => {
    if (!confirm("إلغاء كل روابط مشاركة هذا الملخص؟ سيفقد كل من يملك رابطاً الوصول.")) return;
    const r = await revokeBriefSharesAction(taskId);
    setLink(null); setMsg(r.error ?? "أُلغيت كل روابط المشاركة.");
  });
  const copy = async () => { if (link) { await navigator.clipboard.writeText(link.url); setMsg("تم نسخ الرابط."); } };
  const nativeShare = async () => { if (link) await navigator.share({ title: "ملخص الإنتاج", url: link.url }).catch(() => {}); };

  return (
    <section className="card space-y-3">
      <h2 className="font-medium">ملخص الإنتاج (PDF)</h2>
      <p className="text-sm text-slate-500">يُولَّد من تفاصيل المهمة الحالية، بما فيها السكريبت مشهداً بمشهد.</p>
      <div className="flex flex-wrap gap-2">
        <a className="btn" href={`${base}?download=1`}>تنزيل PDF</a>
        <a className="btn-secondary" href={base} target="_blank" rel="noreferrer">معاينة</a>
      </div>
      {canShare && (
        <div className="space-y-2 border-t pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="label" htmlFor="share-days">صلاحية الرابط</label>
              <select id="share-days" className="input !w-36" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d === 1 ? "يوم" : d === 3 ? "3 أيام" : `${d} يوماً`}</option>)}</select></div>
            <button type="button" className="btn-secondary" onClick={create} disabled={pending}>مشاركة PDF</button>
            <button type="button" className="text-sm text-red-600 underline" onClick={revoke} disabled={pending}>إلغاء كل الروابط</button>
          </div>
          {link && (
            <div className="space-y-2 rounded-md bg-slate-50 p-3 text-sm">
              <p className="text-amber-700">أي شخص يملك هذا الرابط يستطيع فتح الملخص دون تسجيل دخول حتى <bdi>{new Date(link.expiresAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</bdi>.</p>
              <input readOnly value={link.url} className="input" onFocus={(e) => e.currentTarget.select()} aria-label="رابط المشاركة" />
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={copy}>نسخ الرابط</button>
                {typeof navigator !== "undefined" && "share" in navigator && <button type="button" className="btn-secondary" onClick={nativeShare}>مشاركة…</button>}
              </div>
            </div>
          )}
          {msg && <p role="status" className="text-sm text-slate-600">{msg}</p>}
        </div>
      )}
    </section>
  );
}
