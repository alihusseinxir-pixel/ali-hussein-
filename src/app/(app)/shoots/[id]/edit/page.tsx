import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { ActionForm } from "@/components/ActionForm";
import { ShootForm } from "@/components/ShootForm";
import { updateShootAction } from "@/app/actions/shoots";
import { getShoot } from "@/lib/shoots";
import { shootFormData } from "@/lib/shoot-form-data";

export default async function EditShoot({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("shoot:manage");
  const { id } = await params;
  const s = await getShoot(user, id);
  if (!s) notFound();
  if (s.status !== "PLANNED") redirect(`/shoots/${id}`);
  const data = await shootFormData(user, s.contents.map((c) => c.taskId));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">تعديل: {s.title}</h1><Link href={`/shoots/${id}`} className="text-sm text-brand-600 underline">← إلغاء</Link></div>
      <ActionForm action={updateShootAction.bind(null, id)} submitLabel="حفظ التعديلات" className="space-y-6">
        <ShootForm {...data} shoot={s} chosenTalents={s.talents.map((t) => t.talentId)} chosenTasks={s.contents.map((c) => c.taskId)} />
      </ActionForm>
    </div>
  );
}
