import type { Task, TaskStage } from "@prisma/client";
import { formatDateTime } from "@/lib/datetime";
import { MediaView } from "./MediaView";

interface F { id: string; fileName: string; fileType: string; kind: string; version: number }

/** What a reviewer needs in front of them: the latest deliverable plus the publishing details. */
export function ReviewCard({ task, files, tz }: { task: Task; files: F[]; tz: string }) {
  const stage: TaskStage = task.stage;
  const wanted = stage === "PRODUCTION_REVIEW" ? "RAW" : "FINAL";
  const media = files.filter((f) => f.kind === wanted).slice(0, stage === "PRODUCTION_REVIEW" ? 4 : 1);
  const thumb = files.find((f) => f.kind === "THUMBNAIL");
  const final = stage === "SOCIAL_APPROVAL";
  return (
    <section className="card space-y-4 border-amber-300 bg-amber-50/40">
      <h2 className="font-medium">{final ? "Final approval" : "Review"}: {wanted === "RAW" ? "production material" : "latest output"}</h2>
      {media.length === 0 && <p className="text-sm text-slate-500">No {wanted.toLowerCase()} file has been uploaded.</p>}
      <div className="flex flex-wrap gap-4">
        {media.map((m) => (
          <figure key={m.id} className="max-w-sm"><MediaView id={m.id} type={m.fileType} name={m.fileName} />
            <figcaption className="mt-1 text-xs text-slate-500">{m.fileName} · V{m.version}</figcaption></figure>
        ))}
        {final && thumb && <figure className="max-w-[12rem]"><MediaView id={thumb.id} type={thumb.fileType} name={thumb.fileName} /><figcaption className="mt-1 text-xs text-slate-500">Thumbnail</figcaption></figure>}
      </div>
      {final && (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="label">Platform</dt><dd>{task.platform?.toLowerCase() ?? "—"}</dd></div>
          <div><dt className="label">Publishing</dt><dd>{formatDateTime(task.publishAt, tz)}</dd></div>
          <div className="sm:col-span-2"><dt className="label">Caption</dt><dd className="whitespace-pre-wrap">{task.caption ?? "—"}</dd></div>
          <div className="sm:col-span-2"><dt className="label">Hashtags</dt><dd>{task.hashtags ?? "—"}</dd></div>
        </dl>
      )}
    </section>
  );
}
