import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/datetime";
import { requireUser } from "@/lib/session";
import { getScript } from "@/lib/script";
import { EDITABLE } from "@/lib/script-workflow";
import { TaskError } from "@/lib/tasks";
import { ScriptEditor } from "@/components/ScriptEditor";

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const s = await getScript(user, id).catch((e) => { if (e instanceof TaskError) return null; throw e; });
  if (!s) notFound();
  const locked = ["PUBLISHED", "COMPLETED"].includes(s.task.stage);
  const editable = s.perms.editor && EDITABLE.includes(s.task.scriptStatus) && !locked;
  const initial = s.scenes.map((x) => ({
    durationSec: x.durationSec, shotDescription: x.shotDescription, cameraAngle: x.cameraAngle ?? "", visualAction: x.visualAction ?? "",
    dialogue: x.dialogue ?? "", onScreenText: x.onScreenText ?? "", audio: x.audio ?? "", props: x.props ?? "", notes: x.notes ?? "",
  }));
  return (
    <div className="space-y-6">
      <header>
        <Link href={`/tasks/${id}`} className="text-sm text-brand-600 underline">← العودة إلى المهمة</Link>
        <div className="mt-2 text-xs font-medium text-slate-400">{s.task.taskCode}</div>
        <h1 className="text-2xl font-semibold">سكريبت: {s.task.title}</h1>
        {!editable && <p className="mt-1 text-sm text-slate-500">السكريبت للقراءة فقط في حالته الحالية.{s.perms.editor && !locked && " أعده إلى مسودة لتعديله."}</p>}
      </header>
      {s.task.script && s.scenes.length === 0 && (
        <details className="card"><summary className="cursor-pointer text-sm font-medium">النص القديم للسكريبت (قبل المشاهد)</summary>
          <pre className="mt-2 whitespace-pre-wrap text-sm">{s.task.script}</pre></details>
      )}
      <ScriptEditor taskId={id} initial={initial} initialVersion={s.version} status={s.task.scriptStatus} editable={editable}
        perms={s.perms} revisions={s.revisions.map((r) => ({ id: r.id, version: r.version, action: r.action, note: r.note, actorName: r.actorName, when: formatDateTime(r.createdAt, env.timezone) }))} />
    </div>
  );
}
