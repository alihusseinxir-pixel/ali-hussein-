import { describe, expect, it } from "vitest";
import { BASE_FIELDS, BUILTIN_TEMPLATES, customFromRow, extraEntries, missingRequired, resolveTemplate, sanitizeExtra, visibleFields } from "./templates";

describe("built-in templates", () => {
  it("covers every content type exactly once and keeps keys unique", () => {
    expect(new Set(BUILTIN_TEMPLATES.map((t) => t.contentType)).size).toBe(9);
    expect(new Set(BUILTIN_TEMPLATES.map((t) => t.key)).size).toBe(BUILTIN_TEMPLATES.length);
  });
  it("only references fields that exist", () => {
    for (const t of BUILTIN_TEMPLATES) {
      for (const f of t.show) expect(BASE_FIELDS).toContain(f);
      for (const r of t.required) {
        if (r.startsWith("extra.")) expect(t.extra.map((e) => `extra.${e.key}`)).toContain(r);
        else expect(BASE_FIELDS).toContain(r);
      }
      for (const k of Object.keys(t.defaults)) expect(BASE_FIELDS).toContain(k);
    }
  });
  it("required base fields are visible (otherwise the form could never be completed)", () => {
    for (const t of BUILTIN_TEMPLATES) for (const r of t.required) if (!r.startsWith("extra.")) expect(t.show).toContain(r);
  });
});

describe("template behaviour", () => {
  const reel = resolveTemplate("instagram-reel")!;
  const photo = resolveTemplate("product-photography")!;
  it("generates different fields per type", () => {
    expect(visibleFields(reel)).toContain("script");
    expect(visibleFields(photo)).not.toContain("script");
    expect(visibleFields(photo)).not.toContain("models");
    expect(photo.extra.map((e) => e.key)).toEqual(expect.arrayContaining(["background", "lighting", "angles", "shotList"]));
    expect(visibleFields(null)).toEqual([...BASE_FIELDS]);
  });
  it("never hides a field that already holds data", () => {
    expect(visibleFields(photo, { script: "legacy script" })).toContain("script");
    expect(visibleFields(photo, { script: "" })).not.toContain("script");
  });
  it("reports missing required fields with readable names", () => {
    expect(missingRequired(reel, { objective: "x", script: "  " }, {})).toEqual(["Script"]);
    expect(missingRequired(photo, { product: "p" }, {})).toEqual(["Shot list"]);
    expect(missingRequired(photo, { product: "p" }, { shotList: "1." })).toEqual([]);
  });
  it("sanitises extras: only defined keys, trimmed, blanks removed, existing kept", () => {
    expect(sanitizeExtra(photo, { lighting: "  soft ", hacker: "x", angles: "" }, { angles: "old", other: "keep" }))
      .toEqual({ lighting: "soft", other: "keep" });
    expect(sanitizeExtra(null, { a: "b" })).toEqual({});
    expect(sanitizeExtra(photo, { lighting: "x".repeat(9000) }).lighting).toHaveLength(5000);
  });
  it("labels extras for display", () => {
    expect(extraEntries(photo, { lighting: "soft", legacy: "v" })).toEqual([{ label: "Lighting", value: "soft" }, { label: "legacy", value: "v" }]);
  });
});

describe("custom templates", () => {
  const row = { id: "abc", name: "Tazaj Reel", contentType: "REEL" as const, fields: { base: "instagram-reel", defaults: { hashtags: "#tazaj", cta: "  " } } };
  it("extends a built-in with the org's defaults", () => {
    const t = customFromRow(row)!;
    expect(t.key).toBe("custom:abc");
    expect(t.name).toBe("Tazaj Reel");
    expect(t.defaults.hashtags).toBe("#tazaj");
    expect(t.defaults.cta).toBeUndefined(); // blank defaults ignored
    expect(t.defaults.script).toContain("SCENE 01"); // base defaults kept
    expect(t.required).toEqual(resolveTemplate("instagram-reel")!.required);
  });
  it("resolves by ref and fails safe for unknown / broken rows", () => {
    expect(resolveTemplate("custom:abc", [row])?.name).toBe("Tazaj Reel");
    expect(resolveTemplate("custom:zzz", [row])).toBeNull();
    expect(resolveTemplate("blank")).toBeNull();
    expect(resolveTemplate("nope")).toBeNull();
    expect(customFromRow({ ...row, fields: { base: "gone" } })).toBeNull();
    expect(customFromRow({ ...row, fields: null })).toBeNull();
  });
});
