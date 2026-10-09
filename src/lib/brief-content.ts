/** Pure helpers for the production-brief PDF (no React / no I/O, unit-tested). */

export interface Scene { title: string; body: string }

const SCENE_HEAD = /^\s*(?:(?:scene|shot)\s*#?\s*(\d+)|(?:ال)?مشهد\s*(?:رقم\s*)?([\d٠-٩]+))\s*[:\-–—.)]*\s*(.*)$/i;

const toWesternDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

/** Split a free-text script into scenes on "SCENE 01 – …" / "Scene 2:" / "مشهد 3" lines. */
export function parseScenes(script: string | null | undefined): Scene[] {
  const text = (script ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const scenes: { n: number; head: string; lines: string[] }[] = [];
  const preamble: string[] = [];
  for (const line of text.split("\n")) {
    const m = SCENE_HEAD.exec(line);
    if (m) scenes.push({ n: Number(toWesternDigits(m[1] ?? m[2])), head: m[3].trim(), lines: [] });
    else if (scenes.length) scenes[scenes.length - 1].lines.push(line);
    else preamble.push(line);
  }
  if (scenes.length === 0) return [{ title: "SCRIPT", body: text }];
  const out: Scene[] = scenes.map((s) => ({
    title: `SCENE ${String(s.n).padStart(2, "0")}`,
    body: [s.head, ...s.lines].join("\n").trim(),
  }));
  const intro = preamble.join("\n").trim();
  return intro ? [{ title: "OVERVIEW", body: intro }, ...out] : out;
}

export const hasArabic = (s: string) => /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(s);

/** The embedded font has no emoji glyphs; drop them rather than print empty boxes. */
export function pdfSafe(s: string | null | undefined): string {
  return (s ?? "").replace(/[\p{Extended_Pictographic}‍️]/gu, "").replace(/[ \t]{2,}/g, " ").trim();
}

export function briefFileName(taskCode: string): string {
  return `${taskCode}-production-brief.pdf`;
}

/** Base direction by the first strong letter (UAX #9 rule P2), so "عربي. English" and "English عربي" each lay out naturally. */
export function textDirection(s: string): "rtl" | "ltr" {
  const first = /\p{L}/u.exec(s)?.[0];
  return first && hasArabic(first) ? "rtl" : "ltr";
}
