import { describe, expect, it } from "vitest";
import { DEFAULT_CHECKLIST, PHASES, missingInfo, overlaps } from "./shoot-checks";

const d = (h: number) => new Date(Date.UTC(2026, 9, 12, h));
const full = { startsAt: d(9), endsAt: d(12), callTime: d(8), locationId: "l", photographerId: "p", videographerId: null, shotList: "x", requiredItems: "y", talentCount: 1, contentCount: 1 };

describe("shoot checks", () => {
  it("detects overlap but treats back-to-back sessions as free", () => {
    expect(overlaps(d(9), d(12), d(11), d(14))).toBe(true);
    expect(overlaps(d(9), d(12), d(12), d(14))).toBe(false);
    expect(overlaps(d(9), d(12), d(7), d(9))).toBe(false);
    expect(overlaps(d(9), d(12), d(10), d(11))).toBe(true); // contained
  });
  it("reports nothing for a complete session", () => { expect(missingInfo(full)).toEqual([]); });
  it("reports each missing required piece", () => {
    const codes = missingInfo({ ...full, locationId: null, photographerId: null, callTime: null, shotList: "  ", requiredItems: null, talentCount: 0, contentCount: 0 }).map((w) => w.code);
    expect(codes.sort()).toEqual(["call", "content", "crew", "items", "location", "shotlist", "talent"].sort());
  });
  it("accepts either a photographer or a videographer as crew", () => {
    expect(missingInfo({ ...full, photographerId: null, videographerId: "v" })).toEqual([]);
  });
  it("seeds a checklist for every phase", () => { for (const p of PHASES) expect(DEFAULT_CHECKLIST[p].length).toBeGreaterThan(0); });
});
