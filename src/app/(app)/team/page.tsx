import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { ROLE_LABELS } from "@/lib/rbac";
import { ActionForm } from "@/components/ActionForm";
import { Field, Input } from "@/components/Field";
import { inviteMemberAction, revokeInvitationAction, updateMemberAction } from "@/app/actions/team";
import { formatDateTime } from "@/lib/datetime";
import { env } from "@/lib/env";

export default async function TeamPage() {
  const user = await requirePermission("user:manage");
  const [members, invites] = await Promise.all([
    db.user.findMany({ where: { organizationId: user.organizationId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    db.invitation.findMany({ where: { organizationId: user.organizationId, acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
  ]);
  const roles = Object.entries(ROLE_LABELS);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Team</h1>
      <section className="card">
        <h2 className="mb-3 font-medium">Invite a member</h2>
        <ActionForm action={inviteMemberAction} submitLabel="Send invitation" className="grid items-end gap-3 md:grid-cols-5" successMessage="Invitation sent.">
          <Field label="Name" name="name"><Input name="name" required /></Field>
          <Field label="Email" name="email"><Input name="email" type="email" required /></Field>
          <Field label="Role" name="role"><select id="role" name="role" className="input" defaultValue="VIDEOGRAPHER">{roles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Department" name="department"><Input name="department" /></Field>
        </ActionForm>
      </section>
      <section className="card overflow-x-auto !p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Name</th><th className="p-3">Role</th><th className="p-3">Department</th><th className="p-3">Status</th></tr></thead>
          <tbody className="divide-y">
            {members.map((m) => (
              <tr key={m.id}>
                <td className="p-3"><div className="font-medium">{m.name}</div><div className="text-xs text-slate-400">{m.email}</div></td>
                <td className="p-3">
                  <form action={updateMemberAction} className="flex gap-2"><input type="hidden" name="id" value={m.id} />
                    <select name="role" defaultValue={m.role} className="input !w-48 !py-1">{roles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <button className="btn-secondary !py-1">Save</button></form>
                </td>
                <td className="p-3">{m.department ?? "—"}</td>
                <td className="p-3">
                  <form action={updateMemberAction} className="flex items-center gap-2"><input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="status" value={m.status === "ACTIVE" ? "DISABLED" : "ACTIVE"} />
                    <span className={m.status === "ACTIVE" ? "text-green-700" : "text-red-600"}>{m.status.toLowerCase()}</span>
                    {m.id !== user.id && <button className="text-xs underline">{m.status === "ACTIVE" ? "Disable" : "Enable"}</button>}</form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {invites.length > 0 && (
        <section className="card">
          <h2 className="mb-3 font-medium">Pending invitations</h2>
          <ul className="divide-y text-sm">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2">
                <span>{i.name} · {i.email} · {ROLE_LABELS[i.role]} <span className="text-slate-400">(expires {formatDateTime(i.expiresAt, env.timezone)})</span></span>
                <form action={revokeInvitationAction}><input type="hidden" name="id" value={i.id} /><button className="text-xs text-red-600 underline">Revoke</button></form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
