import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { listNotifications, markAllRead, markRead, unreadCount } from "@/lib/notifications";
import { json, sameOrigin } from "@/lib/api-guard";

export const runtime = "nodejs";

/** GET /api/notifications?limit=8  →  { unread, items[] }  (polled by the bell) */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Not signed in" }, 401);
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 8);
  const [unread, { items }] = await Promise.all([unreadCount(user), listNotifications(user, { pageSize: Number.isFinite(limit) ? limit : 8 })]);
  return json({
    unread,
    items: items.map((n) => ({ id: n.id, type: n.type, message: n.message, taskId: n.taskId, read: !!n.readAt, createdAt: n.createdAt.toISOString() })),
  }, 200);
}

const body = z.union([z.object({ action: z.literal("read"), ids: z.array(z.string()).max(200) }), z.object({ action: z.literal("readAll") })]);

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const user = await getCurrentUser();
  if (!user) return json({ error: "Not signed in" }, 401);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Bad request" }, 400);
  const updated = parsed.data.action === "readAll" ? await markAllRead(user) : await markRead(user, parsed.data.ids);
  return json({ updated, unread: await unreadCount(user) });
}
