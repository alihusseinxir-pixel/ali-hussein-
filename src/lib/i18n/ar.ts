/** Arabic UI strings (display layer only — server-side labels in workflow.ts/rbac.ts stay as-is for emails, PDFs and tests). */
import type { CalendarEventType, Priority, Role, TaskStage } from "@prisma/client";

export const AR_STAGE: Record<TaskStage, string> = {
  IDEA: "فكرة",
  BRIEF: "تم إعداد الملخص",
  ASSIGNED: "تم الإسناد",
  PRODUCTION: "التصوير",
  PRODUCTION_REVIEW: "مراجعة التصوير",
  EDITING: "المونتاج / التصميم",
  EDITING_REVIEW: "مراجعة المونتاج",
  INTERNAL_APPROVAL: "الموافقة الداخلية",
  SOCIAL_APPROVAL: "موافقة السوشيال ميديا",
  SCHEDULED: "مجدول",
  PUBLISHED: "منشور",
  COMPLETED: "مكتمل",
};

export const AR_PRIORITY: Record<Priority, string> = { LOW: "منخفضة", MEDIUM: "متوسطة", HIGH: "عالية", URGENT: "عاجلة" };

export const AR_ROLE: Record<Role, string> = {
  ADMIN: "مدير النظام",
  MARKETING_MANAGER: "مدير التسويق",
  SOCIAL_MEDIA_MANAGER: "مسؤول السوشيال ميديا",
  VIDEOGRAPHER: "مصوّر فيديو",
  PHOTOGRAPHER: "مصوّر فوتوغرافي",
  VIDEO_EDITOR: "مونتير",
  DESIGNER: "مصمم",
};

export const AR_EVENT: Record<CalendarEventType, string> = {
  SHOOTING: "تصوير فيديو",
  PHOTOGRAPHY: "تصوير فوتوغرافي",
  EDITING: "مونتاج",
  DESIGN: "تصميم",
  REVIEW: "مراجعة",
  PUBLISHING: "نشر",
};

export const AR_NAV = {
  dashboard: "لوحة التحكم",
  myTasks: "مهامي",
  tasks: "المهام",
  campaigns: "الحملات",
  calendar: "التقويم",
  approvals: "الموافقات",
  team: "الفريق",
  templates: "القوالب",
  files: "الملفات",
  analytics: "التحليلات",
  notifications: "الإشعارات",
  account: "حسابي",
  signOut: "تسجيل الخروج",
  home: "الرئيسية",
} as const;

export const AR_SCRIPT_STATUS = {
  DRAFT: "مسودة",
  IN_REVIEW: "قيد المراجعة",
  CHANGES_REQUESTED: "مطلوب تعديلات",
  APPROVED: "معتمد",
  READY_FOR_PRODUCTION: "جاهز للتصوير",
} as const;

export const AR_SHOOT_STATUS = { PLANNED: "مخطط", COMPLETED: "تم التصوير", CANCELLED: "ملغاة" } as const;

import type { Permission } from "./../rbac";
export const AR_PERMISSION: Record<Permission, string> = {
  "user:manage": "دعوة الأعضاء وتعطيلهم وتغيير أدوارهم",
  "org:settings": "تعديل إعدادات المؤسسة",
  "task:create": "إنشاء المهام",
  "task:view:all": "عرض كل المهام",
  "task:edit:any": "تعديل أي مهمة",
  "task:edit:own": "تعديل المهام التي أنشأها",
  "task:assign": "إسناد المهام وإدارة المتعاونين",
  "task:delete": "حذف المهام",
  "task:comment": "التعليق على المهام",
  "campaign:manage": "إدارة البراندات والحملات",
  "template:manage": "إدارة القوالب",
  "activity:view:all": "عرض سجل الأنشطة الكامل",
  "analytics:view:all": "عرض تحليلات المؤسسة كاملة",
  "approval:internal": "الموافقة الداخلية واعتماد السكريبت",
  "approval:final": "الموافقة النهائية",
  "publish:manage": "جدولة المحتوى ونشره",
  "calendar:view:all": "عرض تقويم الجميع",
  "shoot:manage": "إدارة جلسات التصوير والمودلز واللوكيشنات",
};
