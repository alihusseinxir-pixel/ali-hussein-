"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { NotificationType } from "@prisma/client";
import { NOTIFICATION_META, timeAgo } from "@/lib/notification-ui";

interface Item { id: string; type: NotificationType; message: string; taskId: string | null; read: boolean; createdAt: string }
const POLL_MS = 30_000;

export function NotificationBell() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications?limit=8", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setUnread(d.unread); setItems(d.items);
    } catch { /* offline: keep what we have */ }
  }, []);

  // Light "realtime": poll while the tab is visible and refresh when it regains focus.
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function post(body: object) {
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await load();
  }
  async function openItem(n: Item) {
    setOpen(false);
    if (!n.read) await post({ action: "read", ids: [n.id] });
    if (n.taskId) router.push(`/tasks/${n.taskId}`);
  }

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => { setOpen(!open); if (!open) load(); }} aria-label={`الإشعارات${unread ? `، ${unread} غير مقروء` : ""}`} aria-expanded={open}
        className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && <span className="absolute -end-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="الإشعارات" className="absolute end-0 z-30 mt-2 w-80 max-w-[90vw] rounded-lg border bg-white shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
            <b>الإشعارات</b>
            {unread > 0 && <button type="button" className="text-xs text-brand-600 underline" onClick={() => post({ action: "readAll" })}>تعليم الكل كمقروء</button>}
          </div>
          <ul className="max-h-96 divide-y overflow-y-auto">
            {items.length === 0 && <li className="p-4 text-center text-sm text-slate-500">لا توجد إشعارات جديدة.</li>}
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)} className={`flex w-full gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 ${n.read ? "text-slate-500" : "bg-brand-50/40"}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : NOTIFICATION_META[n.type].dot}`} />
                  <span className="min-w-0"><span className="block break-words">{n.message}</span>
                    <span className="text-xs text-slate-400">{NOTIFICATION_META[n.type].label} · {timeAgo(n.createdAt)}</span></span>
                </button>
              </li>
            ))}
          </ul>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t px-3 py-2 text-center text-sm text-brand-600 hover:bg-slate-50">عرض الكل</Link>
        </div>
      )}
    </div>
  );
}
