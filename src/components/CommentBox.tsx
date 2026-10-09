"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCommentAction } from "@/app/actions/tasks";
import { uploadTaskFile } from "@/lib/upload-client";

export function CommentBox({ taskId, people }: { taskId: string; people: { id: string; name: string }[] }) {
  const router = useRouter();
  const text = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function insertMention(name: string) {
    const el = text.current; if (!el || !name) return;
    const pos = el.selectionStart ?? el.value.length;
    el.value = `${el.value.slice(0, pos)}@${name} ${el.value.slice(pos)}`;
    el.focus();
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const files = Array.from(file.current?.files ?? []);
    start(async () => {
      setError(null);
      const res = await addCommentAction(taskId, undefined, fd);
      if (!res?.ok || !res.data) { setError(res?.error ?? "تعذّر نشر التعليق."); return; }
      for (const f of files) {
        try { await uploadTaskFile(taskId, f, "OTHER", res.data); }
        catch (e) { setError(`نُشر التعليق، لكن فشل رفع ${f.name}: ${e instanceof Error ? e.message : "خطأ في الرفع"}`); break; }
      }
      if (text.current) text.current.value = "";
      if (file.current) file.current.value = "";
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea ref={text} name="body" rows={3} required maxLength={5000} className="input" placeholder="اكتب تعليقاً… استخدم @الاسم للإشارة إلى شخص" />
      <div className="flex flex-wrap items-center gap-3">
        <select className="input !w-48" defaultValue="" onChange={(e) => { insertMention(e.target.value); e.target.value = ""; }} aria-label="الإشارة إلى شخص">
          <option value="">@ إشارة…</option>
          {people.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select>
        <input ref={file} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.mp4,.mov,.docx,.xlsx" className="text-sm" />
        <button className="btn ms-auto" disabled={pending}>{pending ? "جارٍ النشر…" : "نشر التعليق"}</button>
      </div>
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </form>
  );
}
