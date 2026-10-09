import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { listBrandsWithCampaigns } from "@/lib/campaigns";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { ProgressBar } from "@/components/ProgressBar";
import { archiveBrandAction, createBrandAction, createCampaignAction } from "@/app/actions/campaigns";
import { formatDateTime } from "@/lib/datetime";
import { env } from "@/lib/env";

export default async function CampaignsPage() {
  const user = await requireUser();
  const { brands, summaries } = await listBrandsWithCampaigns(user);
  const manage = can(user.role, "campaign:manage");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Brands &amp; Campaigns</h1>
      {manage && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="card"><h2 className="mb-3 font-medium">New brand</h2>
            <ActionForm action={createBrandAction} submitLabel="Add brand" successMessage="Brand added.">
              <Field label="Name" name="name"><Input name="name" required /></Field></ActionForm></section>
          <section className="card"><h2 className="mb-3 font-medium">New campaign</h2>
            <ActionForm action={createCampaignAction} submitLabel="Add campaign" successMessage="Campaign added.">
              <Field label="Brand" name="brandId"><select id="brandId" name="brandId" className="input" defaultValue="">
                <option value="" disabled>Choose…</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
              <Field label="Name" name="name"><Input name="name" required /></Field></ActionForm></section>
        </div>
      )}
      {brands.length === 0 && <p className="text-sm text-slate-500">No campaigns to show yet.</p>}
      {brands.map((b) => (
        <section key={b.id} className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">{b.name}</h2>
            {manage && b.campaigns.length === 0 && <form action={archiveBrandAction}><input type="hidden" name="id" value={b.id} /><button className="text-xs text-red-600 underline">Archive brand</button></form>}
          </div>
          {b.campaigns.length === 0 && <p className="text-sm text-slate-400">No campaigns</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {b.campaigns.map((c) => {
              const s = summaries.get(c.id)!;
              return (
                <Link key={c.id} href={`/campaigns/${c.id}`} className="card block transition hover:border-brand-500 hover:shadow">
                  <div className="flex items-start justify-between gap-2"><h3 className="font-medium">{c.name}</h3><span className="text-xs text-slate-400">{s.total} content</span></div>
                  {(c.startDate || c.endDate) && <p className="text-xs text-slate-400">{formatDateTime(c.startDate, env.timezone).split(",").slice(0, 2).join(",")} → {formatDateTime(c.endDate, env.timezone).split(",").slice(0, 2).join(",")}</p>}
                  <div className="mt-3">{s.total > 0 ? <ProgressBar s={s} /> : <p className="text-xs text-slate-400">No content yet</p>}</div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
