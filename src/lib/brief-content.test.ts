import { describe, expect, it } from "vitest";
import { briefFileName, hasArabic, parseScenes, pdfSafe, textDirection } from "./brief-content";

describe("parseScenes", () => {
  it("splits SCENE headings and keeps text after the dash", () => {
    const s = parseScenes("SCENE 01 – Opening shot\nWide angle\n\nScene 2: Product close-up\nSlow zoom");
    expect(s).toEqual([
      { title: "SCENE 01", body: "Opening shot\nWide angle" },
      { title: "SCENE 02", body: "Product close-up\nSlow zoom" },
    ]);
  });
  it("understands Arabic headings and Arabic-Indic digits", () => {
    const s = parseScenes("مشهد ١ - لقطة افتتاحية\nمشهد 2: الختام");
    expect(s.map((x) => x.title)).toEqual(["SCENE 01", "SCENE 02"]);
    expect(s[0].body).toBe("لقطة افتتاحية");
  });
  it("keeps preamble and falls back to a single block without headings", () => {
    expect(parseScenes("Tone: fun\nSCENE 1 hello")[0]).toEqual({ title: "OVERVIEW", body: "Tone: fun" });
    expect(parseScenes("just a paragraph")).toEqual([{ title: "SCRIPT", body: "just a paragraph" }]);
    expect(parseScenes("  ")).toEqual([]);
    expect(parseScenes(null)).toEqual([]);
  });
});

describe("helpers", () => {
  it("detects Arabic and strips emoji", () => {
    expect(hasArabic("طازج")).toBe(true);
    expect(hasArabic("Tazaj")).toBe(false);
    expect(pdfSafe("Fresh 🍗  with you ❤️")).toBe("Fresh with you");
  });
  it("picks base direction from the first letter", () => {
    expect(textDirection("123 مرحبا")).toBe("rtl");
    expect(textDirection("Hello مرحبا")).toBe("ltr");
    expect(textDirection("…")).toBe("ltr");
  });
  it("names the file after the task code", () => {
    expect(briefFileName("BASMA-2026-00125")).toBe("BASMA-2026-00125-production-brief.pdf");
  });
});
