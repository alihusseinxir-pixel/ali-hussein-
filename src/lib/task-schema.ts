import { z } from "zod";

export const CONTENT_TYPES = [
  "REEL", "STATIC_POST", "CAROUSEL", "STORY", "TIKTOK", "UGC", "CAMPAIGN_VIDEO", "PRODUCT_PHOTOGRAPHY", "PRODUCT_SHOOT",
] as const;
export const PLATFORMS = ["INSTAGRAM", "TIKTOK", "FACEBOOK", "SNAPCHAT", "YOUTUBE", "X", "LINKEDIN"] as const;
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const text = (max = 5000) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const id = z.string().trim().optional().transform((v) => (v ? v : null));
const when = z.string().trim().optional().transform((v) => (v ? v : null));

export const taskInputSchema = z.object({
  title: z.string().trim().min(3, "اسم المهمة 3 أحرف على الأقل").max(200),
  contentType: z.enum(CONTENT_TYPES),
  platform: z.enum(PLATFORMS).optional().or(z.literal("").transform(() => undefined)),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  brandId: id,
  campaignId: id,
  assigneeId: id,
  objective: text(1000),
  targetAudience: text(1000),
  contentPillar: text(200),
  hook: text(500),
  consumerInsight: text(),
  keyMessage: text(),
  cta: text(500),
  caption: text(),
  hashtags: text(1000),
  brief: text(),
  script: text(20000),
  references: text(),
  models: text(),
  location: text(500),
  props: text(),
  product: text(500),
  specialNotes: text(),
  shootingAt: when,
  publishAt: when,
  startDate: when,
  deadline: when,
  templateRef: id,
  allowDuplicate: z.string().optional().transform((v) => v === "1"),
  extra: z.record(z.string(), z.string()).optional(),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const TASK_FIELD_LABELS = {
  objective: "الهدف",
  targetAudience: "الجمهور المستهدف",
  contentPillar: "ركيزة المحتوى",
  hook: "الخطاف (Hook)",
  consumerInsight: "رؤية المستهلك",
  keyMessage: "الرسالة الرئيسية",
  cta: "دعوة لاتخاذ إجراء",
  caption: "الكابشن",
  hashtags: "الهاشتاقات",
  brief: "الملخص",
  script: "السكريبت (نص)",
  references: "المراجع",
  models: "المودلز",
  location: "اللوكيشن",
  props: "الإكسسوارات",
  product: "المنتج",
  specialNotes: "ملاحظات خاصة",
} as const;
