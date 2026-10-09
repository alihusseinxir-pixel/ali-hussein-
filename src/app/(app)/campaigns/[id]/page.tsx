import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { getCampaign } from "@/lib/campaigns";
import { env } from "@/lib/env";
import { formatDateTime, toLocalInput } from "@/lib/datetime";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { ProgressBar } from "@/components/ProgressBar";
import { PriorityBadge, StageBadge } from "@/components/Badges";
import { archiveCampaignAction, updateCampaignAction } from "@/app/actions/campaigns";

const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const found = await getCampaign(user, id);
  if (!found) notFound();
  const { campaign, tasks, summary } = found;
  const tz = env.timezone;
  const manage = can(user.role, "campaign:manage");
  const groups = new Map<string, typeof tasks>();
  for (const t of tasks) groups.set(t.contentType, [...(groups.get(t.contentType) ?? []), t]);

  return (
    <div className="space-y-6">
      <div className="text-sm text-slate-500"><Link href="/campaigns" className="hover:underline">Campaigns</Link> / {campaign.brand.name}</div>
      <header className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{campaign.name}</h1>
            <p className="text-sm text-slate-500">{campaign.brand.name}{(campaign.startDate || campaign.endDate) && ` · ${formatDateTime(campaign.startDate, tz)} → ${formatDateTime(campaign.endDate, tz)}`}</p>
            {campaign.description && <p className="mt-2 whitespace-pre-wrap text-sm">{campaign.description}</p>}
          </div>
          <div className="flex gap-2">
            {can(user.role, "task:create") && <Link href={`/tasks/new?campaign=${campaign.id}`} className="btn">+ Add content</Link>}
            <Link href={`/tasks?campaignId=${campaign.id}`} className="btn-secondary">All tasks</Link>
          </div>
        </div>
        {summary.total > 0 ? <ProgressBar s={summary} legend /> : <p className="text-sm text-slate-500">No content yet. Add the first piece.</p>}
        {!can(user.role, "task:view:all") && <p className="text-xs text-slate-400">Showing only the content you are involved in.</p>}
      </header>

      <section className="space-y-3">
        <h2 className="font-medium">Content ({summary.total})</h2>
        {[...groups.entries()].map(([type, list]) => (
          <div key={type} className="card overflow-x-auto !p-0">
            <div className="border-b bg-slate-50 px-3 py-2 text-xs font-medium uppercase text-slate-500">{pretty(type)} · {list.length}</div>
            <table className="w-full text-left text-sm"><tbody className="divide-y">
              {list.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="p-3"><Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link><div className="text-xs text-slate-400">{t.taskCode}</div></td>
                  <td className="p-3"><StageBadge s={t.stage} /></td><td className="p-3"><PriorityBadge p={t.priority} /></td>
                  <td className="p-3">{t.currentAssignee?.name ?? <span className="text-slate-400">Unassigned</span>}</td>
                  <td className="p-3 text-slate-500">{t.publishAt ? `Publish ${formatDateTime(t.publishAt, tz)}` : t.deadline ? `Due ${formatDateTime(t.deadline, tz)}` : "No deadline"}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        ))}
      </section>

      {manage && (
        <section className="card space-y-4">
          <h2 className="font-medium">Edit campaign</h2>
          <ActionForm action={updateCampaignAction.bind(null, campaign.id)} submitLabel="Save" successMessage="Saved." className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2"><Field label="Name" name="name"><Input name="name" defaultValue={campaign.name} required /></Field></div>
            <div className="md:col-span-2"><Field label="Description" name="description"><textarea id="description" name="description" rows={3} defaultValue={campaign.description ?? ""} className="input" /></Field></div>
            <Field label="Start" name="startDate"><Input name="startDate" type="datetime-local" defaultValue={toLocalInput(campaign.startDate, tz)} /></Field>
            <Field label="End" name="endDate"><Input name="endDate" type="datetime-local" defaultValue={toLocalInput(campaign.endDate, tz)} /></Field>
          </ActionForm>
          <div className="border-t pt-4">
            <ActionForm action={archiveCampaignAction.bind(null, campaign.id)} submitLabel="Archive campaign" danger className="space-y-2">
              <p className="text-sm text-slate-500">Archiving hides the campaign from lists. It is only possible once all of its content is published or completed.</p>
            </ActionForm>
          </div>
        </section>
      )}
    </div>
  );
}
