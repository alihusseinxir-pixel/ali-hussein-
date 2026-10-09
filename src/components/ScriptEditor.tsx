"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ScriptStatus } from "@prisma/client";
import { saveScriptAction, changeScriptStatusAction } from "@/app/actions/script";
import { AR_SCRIPT_STATUS } from "@/lib/i18n/ar";
import { allowedTransitions } from "@/lib/script-workflow";

export interface SceneRow {
  durationSec: number | null; shotDescription: string; cameraAngle: string; visualAction: string;
  dialogue: string; onScreenText: string; audio: string; props: string; notes: string;
}
type Scene = SceneRow & { key: string };
interface Rev { id: string; version: number; action: string; note: string | null; actorName: string; when: string }

const EMPTY: SceneRow = { durationSec: null, shotDescription: "", cameraAngle: "", visualAction: "", dialogue: "", onScreenText: "", audio: "", props: "", notes: "" };
const TEXT_FIELDS: { key: keyof SceneRow; label: string; wide?: boolean }[] = [
  { key: "cameraAngle", label: "زاوية الكاميرا" },
  { key: "visualAction", label: "الحدث المرئي", wide: true },
  { key: "dialogue", label: "الحوار أو التعليق الصوتي", wide: true },
  { key: "onScreenText", label: "النص على الشاشة" },
  { key: "audio", label: "الصوت أو الموسيقى" },
  { key: "props", label: "الإكسسوارات" },
  { key: "notes", label: "ملاحظات الإنتاج" },
];
let seq = 0;
const withKey = (s: SceneRow): Scene => ({ ...s, key: `s${++seq}` });
const strip = ({ key: _k, ...s }: Scene): SceneRow => s;

function actionLabel(a: string) {
  if (a === "saved") return "حفظ";
  const s = a.replace("status:", "") as ScriptStatus;
  return `تغيير الحالة إلى: ${AR_SCRIPT_STATUS[s] ?? s}`;
}

export function ScriptEditor({ taskId, initial, initialVersion, status, editable, perms, revisions }: {
  taskId: string; initial: SceneRow[]; initialVersion: number; status: ScriptStatus; editable: boolean;
  perms: { editor: boolean; reviewer: boolean }; revisions: Rev[];
}) {
  const router = useRouter();
  const [scenes, setScenes] = useState<Scene[]>(() => initial.map(withKey));
  const [version, setVersion] = useState(initialVersion);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const dirty = useMemo(() => JSON.stringify(scenes.map(strip)) !== saved, [scenes, saved]);
  const total = scenes.reduce((n, s) => n + (s.durationSec ?? 0), 0);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Re-sync when the server sends a new version (e.g. after router.refresh()).
  useEffect(() => {
    if (!dirtyRef.current) { setScenes(initial.map(withKey)); setVersion(initialVersion); setSaved(JSON.stringify(initial)); }
  }, [initial, initialVersion]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const patch = (key: string, p: Partial<SceneRow>) => setScenes((l) => l.map((s) => (s.key === key ? { ...s, ...p } : s)));
  const move = (i: number, d: -1 | 1) => setScenes((l) => { const j = i + d; if (j < 0 || j >= l.length) return l; const c = [...l]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const remove = (key: string) => setScenes((l) => l.filter((s) => s.key !== key));

  const save = () => start(async () => {
    const rows = scenes.map(strip);
    const r = await saveScriptAction(taskId, version, rows);
    if (r.error) return setMsg({ type: "err", text: r.error });
    setVersion(r.version!); setSaved(JSON.stringify(rows)); setMsg({ type: "ok", text: "تم حفظ السكريبت." }); router.refresh();
  });
  const change = (to: ScriptStatus) => start(async () => {
    const r = await changeScriptStatusAction(taskId, to, note, version);
    if (r.error) return setMsg({ type: "err", text: r.error });
    setVersion(r.version!); setNote(""); setMsg({ type: "ok", text: `الحالة الآن: ${AR_SCRIPT_STATUS[r.status!]}` }); router.refresh();
  });

  const actions = allowedTransitions(status, perms);
  const needsNote = actions.some((a) => a.needsNote);

  return (
    <div className="space-y-6">
      <section className="card flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="label">حالة السكريبت</span>
          <span className="rounded-full bg-brand-50 px-3 py-1 font-medium text-brand-700">{AR_SCRIPT_STATUS[status]}</span>
          <span className="ms-3 text-slate-500">{scenes.length} مشهد · المدة الإجمالية {total} ثانية</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && <button type="button" className="btn" onClick={save} disabled={pending || !dirty}>{pending ? "جارٍ الحفظ…" : "حفظ السكريبت"}</button>}
          {dirty && <span className="text-xs text-amber-700">توجد تغييرات غير محفوظة</span>}
        </div>
        {msg && <p role="status" className={`w-full rounded-md px-3 py-2 text-sm ${msg.type === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      </section>

      {scenes.length === 0 && <p className="card text-center text-sm text-slate-500">لا توجد مشاهد بعد.{editable && " أضف أول مشهد للبدء."}</p>}

      {scenes.map((s, i) => (
        <section key={s.key} className="card space-y-4" aria-label={`المشهد ${i + 1}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">المشهد {i + 1}</h2>
            {editable && (
              <div className="flex gap-1 text-sm">
                <button type="button" className="btn-secondary !px-2 !py-1" onClick={() => move(i, -1)} disabled={i === 0} aria-label="تحريك للأعلى">↑</button>
                <button type="button" className="btn-secondary !px-2 !py-1" onClick={() => move(i, 1)} disabled={i === scenes.length - 1} aria-label="تحريك للأسفل">↓</button>
                <button type="button" className="btn-secondary !px-2 !py-1 text-red-600" onClick={() => { if (confirm(`حذف المشهد ${i + 1}؟`)) remove(s.key); }}>حذف</button>
              </div>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="block"><span className="label">المدة (ثانية)</span>
              <input type="number" min={0} max={3600} className="input" disabled={!editable} value={s.durationSec ?? ""}
                onChange={(e) => patch(s.key, { durationSec: e.target.value === "" ? null : Math.round(Number(e.target.value)) })} /></label>
            <label className="block md:col-span-3"><span className="label">وصف اللقطة *</span>
              <textarea className="input" rows={2} disabled={!editable} value={s.shotDescription} maxLength={2000} onChange={(e) => patch(s.key, { shotDescription: e.target.value })} aria-invalid={!s.shotDescription.trim()} /></label>
            {TEXT_FIELDS.map((f) => (
              <label key={f.key} className={`block ${f.wide ? "md:col-span-2" : ""}`}><span className="label">{f.label}</span>
                <textarea className="input" rows={2} disabled={!editable} value={s[f.key] as string} onChange={(e) => patch(s.key, { [f.key]: e.target.value })} /></label>
            ))}
          </div>
        </section>
      ))}

      {editable && <button type="button" className="btn-secondary w-full" onClick={() => setScenes((l) => [...l, withKey(EMPTY)])} disabled={scenes.length >= 100}>+ إضافة مشهد</button>}

      {(actions.length > 0) && (
        <section className="card space-y-3">
          <h2 className="font-medium">سير عمل السكريبت</h2>
          {needsNote && <label className="block"><span className="label">ملاحظات (مطلوبة عند طلب التعديلات)</span>
            <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>}
          {dirty && <p className="text-sm text-amber-700">احفظ التغييرات قبل تغيير الحالة.</p>}
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <button key={a.to} type="button" disabled={pending || dirty} onClick={() => change(a.to)}
                className={a.to === "APPROVED" || a.to === "READY_FOR_PRODUCTION" || a.to === "IN_REVIEW" ? "btn" : "btn-secondary"}>{a.label}</button>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2 className="mb-3 font-medium">سجل المراجعات</h2>
        {revisions.length === 0 ? <p className="text-sm text-slate-500">لا يوجد سجل بعد.</p> : (
          <ul className="divide-y text-sm">
            {revisions.map((r) => (
              <li key={r.id} className="py-2"><b>#{r.version}</b> · {actionLabel(r.action)} · {r.actorName}
                <span className="text-xs text-slate-400"> · {r.when}</span>
                {r.note && <p className="mt-1 whitespace-pre-wrap text-slate-600">{r.note}</p>}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
