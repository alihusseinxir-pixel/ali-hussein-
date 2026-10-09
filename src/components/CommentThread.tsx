import type { Role } from "@prisma/client";
import { deleteCommentAction } from "@/app/actions/tasks";
import { ROLE_LABELS } from "@/lib/rbac";
import { mentionSpans, type Person } from "@/lib/mentions";
import { formatDateTime } from "@/lib/datetime";

export function Avatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{initials}</span>;
}

function Body({ body, people }: { body: string; people: Person[] }) {
  const spans = mentionSpans(body, people);
  const parts: React.ReactNode[] = [];
  let at = 0;
  spans.forEach((s, i) => {
    if (s.start > at) parts.push(body.slice(at, s.start));
    parts.push(<span key={i} className="rounded bg-brand-50 px-1 font-medium text-brand-700">{body.slice(s.start, s.end)}</span>);
    at = s.end;
  });
  parts.push(body.slice(at));
  return <p className="whitespace-pre-wrap text-sm">{parts}</p>;
}

export function CommentThread({
  taskId, comments, people, meId, isAdmin, tz,
}: {
  taskId: string; people: Person[]; meId: string; isAdmin: boolean; tz: string;
  comments: { id: string; body: string; createdAt: Date; author: { id: string; name: string; role: Role }; attachments: { id: string; fileName: string; version: number }[] }[];
}) {
  if (comments.length === 0) return <p className="text-sm text-slate-500">No comments yet.</p>;
  return (
    <ul className="space-y-4">
      {comments.map((c) => (
        <li key={c.id} className="flex gap-3">
          <Avatar name={c.author.name} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2 text-xs text-slate-500">
              <b className="text-sm text-slate-900">{c.author.name}</b><span>{ROLE_LABELS[c.author.role]}</span><span>{formatDateTime(c.createdAt, tz)}</span>
              {(c.author.id === meId || isAdmin) && (
                <form action={deleteCommentAction.bind(null, taskId)} className="ms-auto"><input type="hidden" name="commentId" value={c.id} /><button className="text-red-600 underline">Delete</button></form>
              )}
            </div>
            <Body body={c.body} people={people} />
            {c.attachments.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-2 text-xs">
                {c.attachments.map((a) => <li key={a.id}><a className="rounded border px-2 py-0.5 text-brand-600 hover:bg-slate-50" href={`/api/files/${a.id}?download=1`}>📎 {a.fileName}</a></li>)}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
