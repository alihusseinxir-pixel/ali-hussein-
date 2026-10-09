import type { Role, TaskStage } from "@prisma/client";
import { ActionForm } from "./ActionForm";
import { Field, Input } from "./Field";
import { requestChangesAction, submitHandoverAction } from "@/app/actions/tasks";
import { AR_ROLE as ROLE_LABELS, AR_STAGE as STAGE_LABELS } from "@/lib/i18n/ar";
import { handoverRules } from "@/lib/workflow";

export function HandoverPanel({
  taskId, from, to, candidates, revertTo, tz, submitLabel = "تأكيد التسليم",
}: {
  taskId: string; submitLabel?: string; from: TaskStage; to: TaskStage; tz: string;
  candidates: { id: string; name: string; role: Role }[];
  revertTo: TaskStage | null;
}) {
  const rules = handoverRules(from, to);
  return (
    <section className="card space-y-6">
      <div>
        <h2 className="font-medium">تسليم ← {STAGE_LABELS[to]}</h2>
        <p className="mb-4 text-sm text-slate-500">تمرير المهمة يسجّل من ولمن ومتى ولماذا، ولا يُمحى أي شيء.</p>
        <ActionForm action={submitHandoverAction.bind(null, taskId)} submitLabel={submitLabel} className="grid gap-4 md:grid-cols-2" successMessage="تم التسليم.">
          <Field label="إلى" name="toUserId">
            <select id="toUserId" name="toUserId" className="input" defaultValue="" required>
              <option value="" disabled>اختر…</option>
              {candidates.map((u) => <option key={u.id} value={u.id}>{u.name} — {ROLE_LABELS[u.role]}</option>)}
            </select>
          </Field>
          <Field label={rules.needsDeadline ? "الموعد النهائي للمرحلة التالية" : "الموعد النهائي (اختياري)"} name="deadline" hint={`التوقيت: ${tz}`}>
            <Input name="deadline" type="datetime-local" required={rules.needsDeadline} />
          </Field>
          <div className="md:col-span-2"><Field label="التعليمات" name="instructions"><textarea id="instructions" name="instructions" rows={3} className="input" placeholder="ماذا يفعل المستلم؟" /></Field></div>
          <Field label="المخرج المطلوب" name="requiredOutput"><Input name="requiredOutput" placeholder="ريل عمودي 30 ثانية" /></Field>
          {rules.needsDeliverables && (
            <Field label="ما تسلّمه" name="deliverables"><textarea id="deliverables" name="deliverables" rows={2} className="input" placeholder="أفضل اللقطات، ملاحظات، النسخة…" required /></Field>
          )}
          <div className="md:col-span-2"><Field label="تعليقات" name="comments"><textarea id="comments" name="comments" rows={2} className="input" /></Field></div>
        </ActionForm>
      </div>
      {revertTo && (
        <div className="border-t pt-4">
          <h3 className="font-medium">طلب تعديلات ← العودة إلى {STAGE_LABELS[revertTo]}</h3>
          <ActionForm action={requestChangesAction.bind(null, taskId)} submitLabel="طلب تعديلات" className="mt-2 space-y-3" successMessage="أُعيدت المهمة.">
            <textarea name="notes" rows={3} required minLength={5} className="input" placeholder="يرجى تغيير أول 3 ثوانٍ واستبدال الموسيقى." />
          </ActionForm>
        </div>
      )}
    </section>
  );
}
