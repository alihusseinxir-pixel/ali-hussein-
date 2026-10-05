import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { visibleTasksWhere } from "@/lib/tasks";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/datetime";

export default async function FilesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const q = (await searchParams).q?.trim();
  const files = await db.taskAttachment.findMany({
    where: { deletedAt: null, task: visibleTasksWhere(user), ...(q && { fileName: { contains: q, mode: "insensitive" } }) },
    include: { uploadedBy: { select: { name: true } }, task: { select: { id: true, taskCode: true, title: true } } },
    orderBy: { createdAt: "desc" }, take: 200,
  });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Files</h1>
      <form className="flex gap-2"><input name="q" defaultValue={q} placeholder="Search file name" className="input !w-72" /><button className="btn-secondary">Search</button></form>
      <div className="card overflow-x-auto !p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">File</th><th className="p-3">Task</th><th className="p-3">Uploaded</th><th className="p-3" /></tr></thead>
          <tbody className="divide-y">
            {files.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-500">No files.</td></tr>}
            {files.map((f) => (
              <tr key={f.id}>
                <td className="p-3">{f.fileName} <span className="text-xs text-slate-400">V{f.version} · {f.kind.toLowerCase()}</span></td>
                <td className="p-3"><Link className="hover:underline" href={`/tasks/${f.task.id}`}>{f.task.taskCode}</Link> <span className="text-slate-400">{f.task.title}</span></td>
                <td className="p-3 text-slate-500">{f.uploadedBy.name} · {formatDateTime(f.createdAt, env.timezone)}</td>
                <td className="p-3"><a className="text-brand-600 underline" href={`/api/files/${f.id}?download=1`}>Download</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
