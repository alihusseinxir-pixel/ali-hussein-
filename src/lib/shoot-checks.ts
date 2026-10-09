/** Pure shoot-planning rules (no I/O). */
export interface ShootLike {
  startsAt: Date; endsAt: Date; callTime: Date | null; locationId: string | null;
  photographerId: string | null; videographerId: string | null; shotList: string | null; requiredItems: string | null;
  talentCount: number; contentCount: number;
}
export interface Warning { code: string; message: string }

/** Half-open intervals: back-to-back sessions (one ends exactly when the next starts) do not overlap. */
export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;

export function missingInfo(s: ShootLike): Warning[] {
  const w: Warning[] = [];
  const add = (code: string, message: string) => w.push({ code, message });
  if (!s.locationId) add("location", "لم يتم تحديد اللوكيشن.");
  if (!s.photographerId && !s.videographerId) add("crew", "لم يتم تعيين مصور فوتوغرافي أو مصور فيديو.");
  if (s.contentCount === 0) add("content", "لم يتم ربط أي محتوى بجلسة التصوير.");
  if (!s.callTime) add("call", "لم يتم تحديد وقت الحضور (Call time).");
  if (!s.shotList?.trim()) add("shotlist", "قائمة اللقطات فارغة.");
  if (!s.requiredItems?.trim()) add("items", "لم تُحدد المنتجات والإكسسوارات والأزياء المطلوبة.");
  if (s.talentCount === 0) add("talent", "لم يتم تحديد أي مودل.");
  return w;
}

export const PHASE_LABEL = {
  PRE_PRODUCTION: "قبل التصوير",
  SHOOT_DAY: "يوم التصوير",
  HANDOVER: "تسليم الملفات بعد التصوير",
  EQUIPMENT: "المعدات",
} as const;
export const PHASES = ["PRE_PRODUCTION", "EQUIPMENT", "SHOOT_DAY", "HANDOVER"] as const;

/** Seeded into every new shoot; each list stays editable per session. */
export const DEFAULT_CHECKLIST: Record<(typeof PHASES)[number], string[]> = {
  PRE_PRODUCTION: ["تأكيد الموعد مع الفريق والمودلز", "تأكيد اللوكيشن والتصاريح", "تجهيز المنتجات والإكسسوارات والأزياء", "مشاركة السكريبت وقائمة اللقطات مع الفريق"],
  EQUIPMENT: ["الكاميرا والعدسات", "حامل الكاميرا (Tripod)", "الإضاءة", "الميكروفونات", "بطاريات احتياطية", "كروت الذاكرة"],
  SHOOT_DAY: ["حضور الفريق في وقت الحضور", "تصوير جميع اللقطات في القائمة", "مراجعة اللقطات قبل المغادرة", "إعادة المنتجات والمعدات"],
  HANDOVER: ["نسخ الملفات الخام على التخزين المشترك", "رفع الملفات إلى المهام المرتبطة", "تسليم الملفات للمونتير", "تسجيل أي ملاحظات للمونتاج"],
};
