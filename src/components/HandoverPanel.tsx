import type { Role, TaskStage } from "@prisma/client";
import { ActionForm } from "./ActionForm";
import { Field, Input } from "./Field";
import { requestChangesAction, submitHandoverAction } from "@/app/actions/tasks";
import { ROLE_LABELS } from "@/lib/rbac";
import { STAGE_LABELS, handoverRules } from "@/lib/workflow";

export function HandoverPanel({
  taskId, from, to, candidates, revertTo, tz,
}: {
  taskId: string; from: TaskStage; to: TaskStage; tz: string;
  candidates: { id: string; name: string; role: Role }[];
  revertTo: TaskStage | null;
}) {
  const rules = handoverRules(from, to);
  return (
    <section className="card space-y-6">
      <div>
        <h2 className="font-medium">Handover → {STAGE_LABELS[to]}</h2>
        <p className="mb-4 text-sm text-slate-500">Passing the task on records who, what, when and why. Nothing is overwritten.</p>
        <ActionForm action={submitHandoverAction.bind(null, taskId)} submitLabel="Confirm handover" className="grid gap-4 md:grid-cols-2" successMessage="Handed over.">
          <Field label="To" name="toUserId">
            <select id="toUserId" name="toUserId" className="input" defaultValue="" required>
              <option value="" disabled>Choose…</option>
              {candidates.map((u) => <option key={u.id} value={u.id}>{u.name} — {ROLE_LABELS[u.role]}</option>)}
            </select>
          </Field>
          <Field label={rules.needsDeadline ? "Deadline for next stage" : "Deadline (optional)"} name="deadline" hint={`Times are in ${tz}`}>
            <Input name="deadline" type="datetime-local" required={rules.needsDeadline} />
          </Field>
          <div className="md:col-span-2"><Field label="Instructions" name="instructions"><textarea id="instructions" name="instructions" rows={3} className="input" placeholder="What should the receiver do?" /></Field></div>
          <Field label="Required output" name="requiredOutput"><Input name="requiredOutput" placeholder="30 sec vertical Reel" /></Field>
          {rules.needsDeliverables && (
            <Field label="What you are delivering" name="deliverables"><textarea id="deliverables" name="deliverables" rows={2} className="input" placeholder="Best takes, notes, version…" required /></Field>
          )}
          <div className="md:col-span-2"><Field label="Comments" name="comments"><textarea id="comments" name="comments" rows={2} className="input" /></Field></div>
        </ActionForm>
      </div>
      {revertTo && (
        <div className="border-t pt-4">
          <h3 className="font-medium">Request changes → back to {STAGE_LABELS[revertTo]}</h3>
          <ActionForm action={requestChangesAction.bind(null, taskId)} submitLabel="Request changes" className="mt-2 space-y-3" successMessage="Sent back.">
            <textarea name="notes" rows={3} required minLength={5} className="input" placeholder="Please change the first 3 seconds and replace the music." />
          </ActionForm>
        </div>
      )}
    </section>
  );
}
