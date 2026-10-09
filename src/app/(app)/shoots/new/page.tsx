import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { ActionForm } from "@/components/ActionForm";
import { ShootForm } from "@/components/ShootForm";
import { createShootAction } from "@/app/actions/shoots";
import { shootFormData } from "@/lib/shoot-form-data";

export default async function NewShoot({ searchParams }: { searchParams: Promise<{ task?: string }> }) {
  const user = await requirePermission("shoot:manage");
  const { task } = await searchParams;
  const data = await shootFormData(user);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">جلسة تصوير جديدة</h1><Link href="/shoots" className="text-sm text-brand-600 underline">← الجلسات</Link></div>
      <ActionForm action={createShootAction} submitLabel="إنشاء الجلسة" className="space-y-6">
        <ShootForm {...data} chosenTasks={task ? [task] : []} />
      </ActionForm>
    </div>
  );
}
