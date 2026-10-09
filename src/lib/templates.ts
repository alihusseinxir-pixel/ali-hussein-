import type { ContentType, Platform } from "@prisma/client";

/**
 * Task templates (pure data + helpers). A template decides which fields a task form shows,
 * which are required, extra template-specific fields, and starting values.
 * Built-ins live here; organizations can create custom ones that extend a built-in with their own defaults.
 */

export const BASE_FIELDS = [
  "objective", "targetAudience", "consumerInsight", "keyMessage", "cta", "caption", "hashtags", "references", "brief",
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

const CONTENT: BaseField[] = ["objective", "targetAudience", "consumerInsight", "keyMessage", "cta", "caption", "hashtags", "references", "brief", "specialNotes"];
const SHOOT: BaseField[] = ["script", "models", "props", "location", "product", "shootingAt"];
const SCENES = "SCENE 01 – \n\nSCENE 02 – \n\nSCENE 03 – ";

export const BUILTIN_TEMPLATES: TemplateDef[] = [
  {
    key: "instagram-reel", name: "Instagram Reel", description: "Short vertical video: script by scene, shoot details, music.",
    contentType: "REEL", platform: "INSTAGRAM", show: [...CONTENT, ...SHOOT, "publishAt"], required: ["objective", "script"],
    extra: [
      { key: "duration", label: "Duration", placeholder: "30 sec vertical 9:16" },
      { key: "music", label: "Music / audio", placeholder: "Track name, trending audio, or brand sound" },
    ],
    defaults: { script: SCENES },
  },
  {
    key: "product-photography", name: "Product Photography", description: "Studio product shots: background, lighting, angles and shot list.",
    contentType: "PRODUCT_PHOTOGRAPHY", show: ["objective", "brief", "product", "props", "location", "references", "specialNotes", "shootingAt", "publishAt"],
    required: ["product", "extra.shotList"],
    extra: [
      { key: "background", label: "Background", placeholder: "White sweep, wooden table…" },
      { key: "lighting", label: "Lighting", placeholder: "Soft box, natural light, hard shadow…" },
      { key: "angles", label: "Angles", textarea: true, placeholder: "Top-down, 45°, hero front…" },
      { key: "shotList", label: "Shot list", textarea: true, placeholder: "1. Hero shot\n2. Detail close-up\n3. In-context" },
    ],
    defaults: {},
  },
  {
    key: "static-post", name: "Static Post", description: "Single designed image with copy.",
    contentType: "STATIC_POST", platform: "INSTAGRAM",
    show: ["objective", "targetAudience", "keyMessage", "cta", "caption", "hashtags", "references", "brief", "product", "specialNotes", "publishAt"],
    required: ["keyMessage", "extra.onImageCopy"],
    extra: [
      { key: "dimensions", label: "Dimensions", placeholder: "1080×1350" },
      { key: "onImageCopy", label: "Copy on the design", textarea: true, placeholder: "Headline, sub-headline, legal line…" },
    ],
    defaults: {},
  },
  {
    key: "carousel", name: "Carousel", description: "Multi-slide post with slide-by-slide copy.",
    contentType: "CAROUSEL", platform: "INSTAGRAM",
    show: ["objective", "targetAudience", "keyMessage", "cta", "caption", "hashtags", "references", "brief", "product", "specialNotes", "publishAt"],
    required: ["extra.slides"],
    extra: [
      { key: "slideCount", label: "Number of slides", placeholder: "5" },
      { key: "slides", label: "Slide-by-slide copy", textarea: true, placeholder: "Slide 1 – …\nSlide 2 – …" },
      { key: "dimensions", label: "Dimensions", placeholder: "1080×1350" },
    ],
    defaults: {},
  },
  {
    key: "story", name: "Story", description: "Vertical story frames with optional interactive stickers.",
    contentType: "STORY", platform: "INSTAGRAM",
    show: ["objective", "keyMessage", "cta", "references", "brief", "product", "specialNotes", "publishAt"],
    required: ["extra.frames"],
    extra: [
      { key: "frames", label: "Frames", textarea: true, placeholder: "Frame 1 – …\nFrame 2 – …" },
      { key: "interactive", label: "Interactive element", placeholder: "Poll, question box, link sticker…" },
      { key: "dimensions", label: "Dimensions", placeholder: "1080×1920" },
    ],
    defaults: {},
  },
  {
    key: "tiktok", name: "TikTok", description: "Short vertical video built for TikTok.",
    contentType: "TIKTOK", platform: "TIKTOK", show: [...CONTENT, ...SHOOT, "publishAt"], required: ["script"],
    extra: [
      { key: "duration", label: "Duration", placeholder: "15–30 sec" },
      { key: "sound", label: "Sound / trend", placeholder: "Trending sound or original audio" },
    ],
    defaults: { script: SCENES },
  },
  {
    key: "ugc", name: "UGC", description: "Creator-made content: brief, deliverables and usage rights.",
    contentType: "UGC", platform: "INSTAGRAM",
    show: ["objective", "brief", "models", "product", "props", "location", "references", "caption", "hashtags", "cta", "specialNotes", "shootingAt", "publishAt"],
    required: ["brief", "extra.deliverables"],
    extra: [
      { key: "creator", label: "Creator / handle", placeholder: "@creator" },
      { key: "deliverables", label: "Deliverables", textarea: true, placeholder: "2 videos, 1 raw file pack…" },
      { key: "usageRights", label: "Usage rights", placeholder: "Paid ads, 6 months…" },
    ],
    defaults: {},
  },
  {
    key: "campaign-video", name: "Campaign Video", description: "Hero campaign film with cut-downs and aspect ratios.",
    contentType: "CAMPAIGN_VIDEO", platform: "YOUTUBE", show: [...CONTENT, ...SHOOT, "publishAt"], required: ["objective", "brief", "script"],
    extra: [
      { key: "duration", label: "Master duration", placeholder: "60 sec" },
      { key: "aspectRatios", label: "Aspect ratios", placeholder: "16:9, 9:16, 1:1" },
      { key: "cutdowns", label: "Cut-downs", textarea: true, placeholder: "30s, 15s, 6s bumper…" },
    ],
    defaults: { script: SCENES },
  },
  {
    key: "product-shoot", name: "Product Shoot", description: "Photo and/or video shoot day with shot list and crew.",
    contentType: "PRODUCT_SHOOT", show: [...CONTENT, ...SHOOT, "publishAt"], required: ["product", "shootingAt", "extra.shotList"],
    extra: [
      { key: "shotList", label: "Shot list", textarea: true, placeholder: "1. …\n2. …" },
      { key: "crew", label: "Crew / equipment", textarea: true },
      { key: "deliverableFormat", label: "Deliverable formats", placeholder: "Stills 4000px, video 4K…" },
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
  objective: "Objective", targetAudience: "Target audience", consumerInsight: "Consumer insight", keyMessage: "Key message", cta: "CTA",
  caption: "Caption", hashtags: "Hashtags", references: "References", brief: "Brief", script: "Script", models: "Models", props: "Props",
  location: "Location", product: "Product", specialNotes: "Special notes", shootingAt: "Shooting date & time", publishAt: "Publishing date & time",
  startDate: "Start date",
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
