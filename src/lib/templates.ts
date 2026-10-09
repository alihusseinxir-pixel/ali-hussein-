import type { ContentType, Platform } from "@prisma/client";

/**
 * Task templates (pure data + helpers). A template decides which fields a task form shows,
 * which are required, extra template-specific fields, and starting values.
 * Built-ins live here; organizations can create custom ones that extend a built-in with their own defaults.
 */

export const BASE_FIELDS = [
  "objective", "targetAudience", "contentPillar", "consumerInsight", "hook", "keyMessage", "cta", "caption", "hashtags", "references", "brief",
  "script", "models", "props", "location", "product", "specialNotes", "shootingAt", "publishAt", "startDate",
] as const;
export type BaseField = (typeof BASE_FIELDS)[number];

export interface ExtraField { key: string; label: string; textarea?: boolean; placeholder?: string; required?: boolean }

export interface TemplateDef {
  key: string;
  name: string;
  description: string;
  contentType: ContentType;
  platform?: Platform;
  show: BaseField[];
  required: (BaseField | `extra.${string}`)[];
  extra: ExtraField[];
  defaults: Partial<Record<BaseField, string>>;
}

const CONTENT: BaseField[] = ["objective", "targetAudience", "contentPillar", "consumerInsight", "hook", "keyMessage", "cta", "caption", "hashtags", "references", "brief", "specialNotes"];
const SHOOT: BaseField[] = ["script", "models", "props", "location", "product", "shootingAt"];
const SCENES = "المشهد 01 – \n\nالمشهد 02 – \n\nالمشهد 03 – ";

export const BUILTIN_TEMPLATES: TemplateDef[] = [
  {
    key: "instagram-reel", name: "ريل إنستغرام", description: "فيديو قصير عمودي: سكريبت بالمشاهد وتفاصيل التصوير والموسيقى.",
    contentType: "REEL", platform: "INSTAGRAM", show: [...CONTENT, ...SHOOT, "publishAt"], required: ["objective", "script"],
    extra: [
      { key: "duration", label: "المدة", placeholder: "30 ثانية عمودي 9:16" },
      { key: "music", label: "الموسيقى / الصوت", placeholder: "اسم المقطع أو صوت رائج أو صوت البراند" },
    ],
    defaults: { script: SCENES },
  },
  {
    key: "product-photography", name: "تصوير منتجات", description: "لقطات استوديو للمنتج: الخلفية والإضاءة والزوايا وقائمة اللقطات.",
    contentType: "PRODUCT_PHOTOGRAPHY", show: ["objective", "brief", "product", "props", "location", "references", "specialNotes", "shootingAt", "publishAt"],
    required: ["product", "extra.shotList"],
    extra: [
      { key: "background", label: "الخلفية", placeholder: "خلفية بيضاء، طاولة خشبية…" },
      { key: "lighting", label: "الإضاءة", placeholder: "سوفت بوكس، ضوء طبيعي، ظل حاد…" },
      { key: "angles", label: "الزوايا", textarea: true, placeholder: "من الأعلى، 45°، أمامية رئيسية…" },
      { key: "shotList", label: "قائمة اللقطات", textarea: true, placeholder: "1. اللقطة الرئيسية\n2. لقطة تفصيلية قريبة\n3. المنتج في سياقه" },
    ],
    defaults: {},
  },
  {
    key: "static-post", name: "منشور ثابت", description: "صورة واحدة مصممة مع نص.",
    contentType: "STATIC_POST", platform: "INSTAGRAM",
    show: ["objective", "targetAudience", "keyMessage", "cta", "caption", "hashtags", "references", "brief", "product", "specialNotes", "publishAt"],
    required: ["keyMessage", "extra.onImageCopy"],
    extra: [
      { key: "dimensions", label: "الأبعاد", placeholder: "1080×1350" },
      { key: "onImageCopy", label: "النص على التصميم", textarea: true, placeholder: "العنوان، العنوان الفرعي، السطر القانوني…" },
    ],
    defaults: {},
  },
  {
    key: "carousel", name: "كاروسيل", description: "منشور متعدد الشرائح مع نص لكل شريحة.",
    contentType: "CAROUSEL", platform: "INSTAGRAM",
    show: ["objective", "targetAudience", "keyMessage", "cta", "caption", "hashtags", "references", "brief", "product", "specialNotes", "publishAt"],
    required: ["extra.slides"],
    extra: [
      { key: "slideCount", label: "عدد الشرائح", placeholder: "5" },
      { key: "slides", label: "نص كل شريحة", textarea: true, placeholder: "الشريحة 1 – …\nالشريحة 2 – …" },
      { key: "dimensions", label: "الأبعاد", placeholder: "1080×1350" },
    ],
    defaults: {},
  },
  {
    key: "story", name: "ستوري", description: "إطارات ستوري عمودية مع ملصقات تفاعلية اختيارية.",
    contentType: "STORY", platform: "INSTAGRAM",
    show: ["objective", "keyMessage", "cta", "references", "brief", "product", "specialNotes", "publishAt"],
    required: ["extra.frames"],
    extra: [
      { key: "frames", label: "الإطارات", textarea: true, placeholder: "الإطار 1 – …\nالإطار 2 – …" },
      { key: "interactive", label: "العنصر التفاعلي", placeholder: "استطلاع، صندوق أسئلة، ملصق رابط…" },
      { key: "dimensions", label: "الأبعاد", placeholder: "1080×1920" },
    ],
    defaults: {},
  },
  {
    key: "tiktok", name: "تيك توك", description: "فيديو قصير عمودي مصمم لتيك توك.",
    contentType: "TIKTOK", platform: "TIKTOK", show: [...CONTENT, ...SHOOT, "publishAt"], required: ["script"],
    extra: [
      { key: "duration", label: "المدة", placeholder: "15–30 ثانية" },
      { key: "sound", label: "الصوت / الترند", placeholder: "صوت رائج أو صوت أصلي" },
    ],
    defaults: { script: SCENES },
  },
  {
    key: "ugc", name: "محتوى المستخدمين (UGC)", description: "محتوى يصنعه صانع محتوى: الملخص والمخرجات وحقوق الاستخدام.",
    contentType: "UGC", platform: "INSTAGRAM",
    show: ["objective", "brief", "models", "product", "props", "location", "references", "caption", "hashtags", "cta", "specialNotes", "shootingAt", "publishAt"],
    required: ["brief", "extra.deliverables"],
    extra: [
      { key: "creator", label: "صانع المحتوى / الحساب", placeholder: "@creator" },
      { key: "deliverables", label: "المخرجات", textarea: true, placeholder: "فيديوهان، حزمة ملفات خام…" },
      { key: "usageRights", label: "حقوق الاستخدام", placeholder: "إعلانات مدفوعة، 6 أشهر…" },
    ],
    defaults: {},
  },
  {
    key: "campaign-video", name: "فيديو حملة", description: "فيلم الحملة الرئيسي مع نسخ مختصرة ونسب عرض متعددة.",
    contentType: "CAMPAIGN_VIDEO", platform: "YOUTUBE", show: [...CONTENT, ...SHOOT, "publishAt"], required: ["objective", "brief", "script"],
    extra: [
      { key: "duration", label: "المدة الرئيسية", placeholder: "60 ثانية" },
      { key: "aspectRatios", label: "نسب العرض", placeholder: "16:9, 9:16, 1:1" },
      { key: "cutdowns", label: "النسخ المختصرة", textarea: true, placeholder: "30ث، 15ث، 6ث…" },
    ],
    defaults: { script: SCENES },
  },
  {
    key: "product-shoot", name: "جلسة منتج", description: "يوم تصوير صور و/أو فيديو مع قائمة لقطات وطاقم.",
    contentType: "PRODUCT_SHOOT", show: [...CONTENT, ...SHOOT, "publishAt"], required: ["product", "shootingAt", "extra.shotList"],
    extra: [
      { key: "shotList", label: "قائمة اللقطات", textarea: true, placeholder: "1. …\n2. …" },
      { key: "crew", label: "الطاقم / المعدات", textarea: true },
      { key: "deliverableFormat", label: "صيغ المخرجات", placeholder: "صور 4000 بكسل، فيديو 4K…" },
    ],
    defaults: {},
  },
];

export const BLANK_REF = "blank";

export const CUSTOM_PREFIX = "custom:";
export interface CustomTemplateRow { id: string; name: string; contentType: ContentType; fields: unknown }

/** Shape stored in ContentTemplate.fields for org-defined templates. */
export interface CustomFields { base: string; description?: string; defaults?: Partial<Record<BaseField, string>> }

export const builtinByKey = (key: string) => BUILTIN_TEMPLATES.find((t) => t.key === key) ?? null;

export function customFromRow(row: CustomTemplateRow): TemplateDef | null {
  const f = row.fields as Partial<CustomFields> | null;
  const base = f?.base ? builtinByKey(f.base) : null;
  if (!base) return null;
  const defaults: TemplateDef["defaults"] = { ...base.defaults };
  for (const k of BASE_FIELDS) { const v = f?.defaults?.[k]; if (typeof v === "string" && v.trim()) defaults[k] = v; }
  return { ...base, key: `${CUSTOM_PREFIX}${row.id}`, name: row.name, description: f?.description || `Based on ${base.name}`, defaults };
}

/** "instagram-reel" | "custom:<id>" | "blank" | null → definition (or null for a free-form task). */
export function resolveTemplate(ref: string | null | undefined, customs: CustomTemplateRow[] = []): TemplateDef | null {
  if (!ref || ref === BLANK_REF) return null;
  if (ref.startsWith(CUSTOM_PREFIX)) {
    const row = customs.find((c) => `${CUSTOM_PREFIX}${c.id}` === ref);
    return row ? customFromRow(row) : null;
  }
  return builtinByKey(ref);
}

const LABELS: Record<BaseField, string> = {
  objective: "الهدف", targetAudience: "الجمهور المستهدف", contentPillar: "ركيزة المحتوى", hook: "الخطاف (Hook)", consumerInsight: "رؤية المستهلك", keyMessage: "الرسالة الرئيسية", cta: "دعوة لاتخاذ إجراء",
  caption: "الكابشن", hashtags: "الهاشتاقات", references: "المراجع", brief: "الملخص", script: "السكريبت (نص)", models: "المودلز", props: "الإكسسوارات",
  location: "اللوكيشن", product: "المنتج", specialNotes: "ملاحظات خاصة", shootingAt: "موعد التصوير", publishAt: "موعد النشر",
  startDate: "تاريخ البداية",
};
export const baseLabel = (k: BaseField) => LABELS[k];

export function requiredLabel(t: TemplateDef, ref: string): string {
  if (ref.startsWith("extra.")) return t.extra.find((e) => `extra.${e.key}` === ref)?.label ?? ref;
  return LABELS[ref as BaseField] ?? ref;
}

/** Fields the form should render: the template's, plus anything that already has a value (so editing never hides data). */
export function visibleFields(t: TemplateDef | null, existing: Partial<Record<BaseField, unknown>> = {}): BaseField[] {
  if (!t) return [...BASE_FIELDS];
  const has = (k: BaseField) => existing[k] !== null && existing[k] !== undefined && existing[k] !== "";
  return BASE_FIELDS.filter((k) => t.show.includes(k) || has(k));
}

/** Names of required fields that are empty. */
export function missingRequired(t: TemplateDef, values: Partial<Record<BaseField, unknown>>, extra: Record<string, string>): string[] {
  return t.required
    .filter((r) => {
      const v = r.startsWith("extra.") ? extra[r.slice(6)] : values[r as BaseField];
      return v === null || v === undefined || (typeof v === "string" && !v.trim());
    })
    .map((r) => requiredLabel(t, r));
}

/** Keep only keys the template defines, trim, drop blanks, cap length. */
export function sanitizeExtra(t: TemplateDef | null, raw: Record<string, unknown> | null | undefined, existing: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = { ...existing };
  if (!t) return out;
  for (const f of t.extra) {
    if (!raw || !(f.key in raw)) continue;
    const v = typeof raw[f.key] === "string" ? (raw[f.key] as string).trim().slice(0, 5000) : "";
    if (v) out[f.key] = v; else delete out[f.key];
  }
  return out;
}

/** For display: extra values labelled with the template's wording (unknown keys fall back to their key). */
export function extraEntries(t: TemplateDef | null, extra: Record<string, string> | null | undefined): { label: string; value: string }[] {
  if (!extra) return [];
  const known = (t?.extra ?? []).filter((f) => extra[f.key]).map((f) => ({ label: f.label, value: extra[f.key] }));
  const knownKeys = new Set((t?.extra ?? []).map((f) => f.key));
  const rest = Object.entries(extra).filter(([k, v]) => !knownKeys.has(k) && v).map(([k, v]) => ({ label: k, value: v }));
  return [...known, ...rest];
}
