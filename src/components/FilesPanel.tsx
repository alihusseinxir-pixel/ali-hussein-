"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadTaskFile } from "@/lib/upload-client";

export interface FileRow {
  id: string; fileName: string; fileType: string; kind: string; version: number; sizeBytes: number;
  uploadedBy: string; createdAt: string; canDelete: boolean;
}
const KINDS = [["RAW", "Raw footage / photos"], ["FINAL", "Final output"], ["REFERENCE", "Reference"], ["THUMBNAIL", "Thumbnail"], ["DOCUMENT", "Document (script, brief…)"], ["OTHER", "Other"]];
const size = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function FilesPanel({ taskId, files, canUpload, maxMb }: { taskId: string; files: FileRow[]; canUpload: boolean; maxMb: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("RAW");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true); setError(null);
    for (const f of Array.from(list)) {
      try { await uploadTaskFile(taskId, f, kind); }
      catch (e) { setError(`${f.name}: ${e instanceof Error ? e.message : "Upload failed"}`); break; }
    }
    setBusy(false); if (input.current) input.current.value = ""; router.refresh();
  }
  async function remove(id: string) {
    if (!confirm("Remove this file version? It stays in the task history.")) return;
    const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Could not remove file");
    router.refresh();
  }

  // group versions of the same file together, newest first
  const groups = new Map<string, FileRow[]>();
  for (const f of files) groups.set(`${f.kind}|${f.fileName}`, [...(groups.get(`${f.kind}|${f.fileName}`) ?? []), f]);

  return (
    <section className="card space-y-4">
      <h2 className="font-medium">Files</h2>
      {canUpload && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed p-3">
          <div><label className="label">Kind</label><select value={kind} onChange={(e) => setKind(e.target.value)} className="input">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className="label">Files</label><input ref={input} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.mp4,.mov,.docx,.xlsx" onChange={(e) => upload(e.target.files)} disabled={busy} className="text-sm" /></div>
          {busy && <span className="text-sm text-slate-500">Uploading…</span>}
          <p className="w-full text-xs text-slate-400">PDF, JPG, PNG, MP4, MOV, DOCX, XLSX · max {maxMb} MB each. Uploading the same name and kind again creates a new version.</p>
        </div>
      )}
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {groups.size === 0 && <p className="text-sm text-slate-500">No files yet.</p>}
      <ul className="divide-y">
        {[...groups.values()].map((versions) => {
          const latest = versions[0];
          return (
            <li key={latest.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><span className="font-medium">{latest.fileName}</span> <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{latest.kind.toLowerCase()}</span></div>
              </div>
              <ul className="mt-2 space-y-1">
                {versions.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                    <span className="w-8 font-semibold">V{v.version}</span>
                    <span>{size(v.sizeBytes)}</span>
                    <span>{v.uploadedBy} · {new Date(v.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
                    {/^(image|video)\//.test(v.fileType) || v.fileType === "application/pdf"
                      ? <button type="button" className="text-brand-600 underline" onClick={() => setPreview(preview === v.id ? null : v.id)}>{preview === v.id ? "Close" : "Preview"}</button> : null}
                    <a className="text-brand-600 underline" href={`/api/files/${v.id}?download=1`}>Download</a>
                    {v.canDelete && <button type="button" className="text-red-600 underline" onClick={() => remove(v.id)}>Remove</button>}
                    {preview === v.id && (
                      <div className="mt-2 w-full">
                        {v.fileType.startsWith("image/") && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/files/${v.id}`} alt={v.fileName} className="max-h-96 rounded" />
                        )}
                        {v.fileType.startsWith("video/") && <video src={`/api/files/${v.id}`} controls className="max-h-96 rounded" />}
                        {v.fileType === "application/pdf" && <iframe src={`/api/files/${v.id}`} title={v.fileName} className="h-96 w-full rounded border" />}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
