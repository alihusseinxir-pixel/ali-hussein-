import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { createBrandAction, createCampaignAction } from "@/app/actions/campaigns";

export default async function CampaignsPage() {
  const user = await requireUser();
  const brands = await db.brand.findMany({
    where: { organizationId: user.organizationId, deletedAt: null }, orderBy: { name: "asc" },
    include: { campaigns: { where: { deletedAt: null }, orderBy: { name: "asc" }, include: { _count: { select: { tasks: true } } } } },
  });
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
      {brands.length === 0 && <p className="text-sm text-slate-500">No brands yet.</p>}
      {brands.map((b) => (
        <section key={b.id} className="card">
          <h2 className="font-medium">{b.name}</h2>
          <ul className="mt-2 divide-y text-sm">
            {b.campaigns.length === 0 && <li className="py-2 text-slate-400">No campaigns</li>}
            {b.campaigns.map((c) => <li key={c.id} className="flex justify-between py-2"><span>{c.name}</span><span className="text-slate-400">{c._count.tasks} tasks</span></li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
