import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listNotifications, unreadCount } from "@/lib/notifications";
import { NOTIFICATION_META, timeAgo } from "@/lib/notification-ui";
import { markAllReadAction, setEmailPreferenceAction } from "@/app/actions/notifications";
import { formatDateTime } from "@/lib/datetime";
import { env } from "@/lib/env";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ unread?: string; page?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const unreadOnly = sp.unread === "1";
  const [{ items, total, page, pages }, unread] = await Promise.all([listNotifications(user, { unreadOnly, page: Number(sp.page) || 1 }), unreadCount(user)]);
  const link = (o: Record<string, string>) => `/notifications?${new URLSearchParams({ ...(unreadOnly ? { unread: "1" } : {}), ...o })}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">الإشعارات <span className="text-base font-normal text-slate-400">({unread} غير مقروء)</span></h1>
        <div className="flex items-center gap-2 text-sm">
          <Link href={unreadOnly ? "/notifications" : "/notifications?unread=1"} className="btn-secondary">{unreadOnly ? "عرض الكل" : "غير المقروء فقط"}</Link>
          {unread > 0 && <form action={markAllReadAction}><button className="btn-secondary">تعليم الكل كمقروء</button></form>}
        </div>
      </div>
      <form action={setEmailPreferenceAction} className="card flex flex-wrap items-center gap-3 !p-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={user.emailNotifications} /> أرسل لي الإشعارات الجديدة بالبريد</label>
        <button className="btn-secondary !py-1">حفظ</button>
        <span className="text-xs text-slate-400">تُرسل كملخص إلى <bdi dir="ltr">{user.email}</bdi> عند ضبط البريد.</span>
      </form>
      <ul className="card divide-y !p-0">
        {items.length === 0 && <li className="p-6 text-center text-sm text-slate-500">{unreadOnly ? "لا توجد إشعارات غير مقروءة." : "لا توجد إشعارات بعد."}</li>}
        {items.map((n) => {
          const m = NOTIFICATION_META[n.type];
          const body = (
            <div className={`flex gap-3 px-4 py-3 text-sm hover:bg-slate-50 ${n.readAt ? "text-slate-500" : ""}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-slate-200" : m.dot}`} />
              <div><p>{n.message}</p><p className="text-xs text-slate-400">{m.label} · {timeAgo(n.createdAt.toISOString())} · <bdi>{formatDateTime(n.createdAt, env.timezone)}</bdi></p></div>
            </div>
          );
          return <li key={n.id}>{n.taskId ? <Link href={`/tasks/${n.taskId}`}>{body}</Link> : body}</li>;
        })}
      </ul>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-4 text-sm">
          {page > 1 && <Link className="underline" href={link({ page: String(page - 1) })}>→ الأحدث</Link>}
          <span>صفحة {page} / {pages} · الإجمالي {total}</span>
          {page < pages && <Link className="underline" href={link({ page: String(page + 1) })}>الأقدم ←</Link>}
        </div>
      )}
    </div>
  );
}
