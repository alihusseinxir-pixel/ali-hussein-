import { describe, expect, it } from "vitest";
import { detectType, safeFileName } from "./file-types";

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
describe("file types", () => {
  it("matches extension with magic bytes", () => {
    expect(detectType("a.jpg", bytes(0xff, 0xd8, 0xff))?.mime).toBe("image/jpeg");
    expect(detectType("a.mp4", new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]))?.mime).toBe("video/mp4");
    expect(detectType("a.docx", bytes(0x50, 0x4b, 0x03, 0x04))?.inline).toBe(false);
  });
  it("rejects mismatches and unknown extensions", () => {
    expect(detectType("a.png", bytes(0xff, 0xd8, 0xff))).toBeNull();
    expect(detectType("a.html", bytes(0x3c))).toBeNull();
    expect(detectType("noext", bytes(0x25, 0x50, 0x44, 0x46))).toBeNull();
  });
  it("sanitises names", () => {
    expect(safeFileName("../../a/b\\c.png")).toBe("c.png");
    expect(safeFileName('x"<>.png')).toBe("x.png");
    expect(safeFileName("")).toBe("file");
  });
});
