/** Allowed upload types. Extension AND magic bytes must agree; the client-supplied MIME type is ignored. */
export interface FileType { mime: string; inline: boolean; check: (head: Uint8Array) => boolean }

const startsWith = (head: Uint8Array, ...bytes: number[]) => bytes.every((b, i) => head[i] === b);
const ftyp = (h: Uint8Array) => h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70; // "ftyp"
const zip = (h: Uint8Array) => startsWith(h, 0x50, 0x4b, 0x03, 0x04);

export const FILE_TYPES: Record<string, FileType> = {
  pdf: { mime: "application/pdf", inline: true, check: (h) => startsWith(h, 0x25, 0x50, 0x44, 0x46) },
  jpg: { mime: "image/jpeg", inline: true, check: (h) => startsWith(h, 0xff, 0xd8, 0xff) },
  jpeg: { mime: "image/jpeg", inline: true, check: (h) => startsWith(h, 0xff, 0xd8, 0xff) },
  png: { mime: "image/png", inline: true, check: (h) => startsWith(h, 0x89, 0x50, 0x4e, 0x47) },
  mp4: { mime: "video/mp4", inline: true, check: ftyp },
  mov: { mime: "video/quicktime", inline: true, check: (h) => ftyp(h) || (h[4] === 0x6d && h[5] === 0x6f && h[6] === 0x6f && h[7] === 0x76) },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inline: false, check: zip },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false, check: zip },
};

export const FILE_KINDS = ["RAW", "FINAL", "REFERENCE", "THUMBNAIL", "DOCUMENT", "OTHER"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/** Strip path components and control characters; keep Unicode (Arabic names) intact. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "").trim().slice(0, 150);
  return cleaned || "file";
}

export function detectType(name: string, head: Uint8Array): FileType | null {
  const t = FILE_TYPES[extensionOf(name)];
  return t && t.check(head) ? t : null;
}
