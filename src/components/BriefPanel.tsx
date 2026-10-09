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
    if (r.error || !r.url) { setMsg(r.error ?? "Could not create link"); return; }
    setLink({ url: r.url, expiresAt: r.expiresAt! });
  });
  const revoke = () => start(async () => {
    if (!confirm("Revoke every share link for this brief? Anyone holding a link will lose access.")) return;
    const r = await revokeBriefSharesAction(taskId);
    setLink(null); setMsg(r.error ?? "All share links revoked.");
  });
  const copy = async () => { if (link) { await navigator.clipboard.writeText(link.url); setMsg("Link copied."); } };
  const nativeShare = async () => { if (link) await navigator.share({ title: "Production brief", url: link.url }).catch(() => {}); };

  return (
    <section className="card space-y-3">
      <h2 className="font-medium">Production brief (PDF)</h2>
      <p className="text-sm text-slate-500">Generated from the current task details, including the script scene by scene.</p>
      <div className="flex flex-wrap gap-2">
        <a className="btn" href={`${base}?download=1`}>Download PDF</a>
        <a className="btn-secondary" href={base} target="_blank" rel="noreferrer">Preview</a>
      </div>
      {canShare && (
        <div className="space-y-2 border-t pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="label" htmlFor="share-days">Link valid for</label>
              <select id="share-days" className="input !w-36" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}</select></div>
            <button type="button" className="btn-secondary" onClick={create} disabled={pending}>Share PDF</button>
            <button type="button" className="text-sm text-red-600 underline" onClick={revoke} disabled={pending}>Revoke all links</button>
          </div>
          {link && (
            <div className="space-y-2 rounded-md bg-slate-50 p-3 text-sm">
              <p className="text-amber-700">Anyone with this link can open the brief without signing in until {new Date(link.expiresAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.</p>
              <input readOnly value={link.url} className="input" onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={copy}>Copy link</button>
                {typeof navigator !== "undefined" && "share" in navigator && <button type="button" className="btn-secondary" onClick={nativeShare}>Share…</button>}
              </div>
            </div>
          )}
          {msg && <p role="status" className="text-sm text-slate-600">{msg}</p>}
        </div>
      )}
    </section>
  );
}
