import { describe, expect, it } from "vitest";
import { MAX_PART, cleanPhone, longDate, maskPhone, splitIntoParts } from "./format";

describe("splitting the detailed report into WhatsApp messages", () => {
  const lines = Array.from({ length: 120 }, (_, i) => `${i + 1}. INV-2026-${String(i).padStart(6, "0")} · John Mushi · 2 x Castrol 15W-40 5L @ 45,000 · Total 90,000`);

  it("keeps every message under the limit, numbers them, and loses no line", () => {
    const parts = splitIntoParts(lines, "SUPER DRIVE OIL\nDAILY DETAILED REPORT\nDate: 05 November 2026");
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((p, i) => {
      expect(p.length).toBeLessThanOrEqual(MAX_PART);
      expect(p).toContain(`PART ${i + 1}/${parts.length}`);
    });
    const body = parts.join("\n");
    for (const l of lines) expect(body).toContain(l);
    // order is preserved
    expect(body.indexOf(lines[0]!)).toBeLessThan(body.indexOf(lines[119]!));
  });

  it("makes one part for a short report, and cuts a single over-long line instead of dropping it", () => {
    expect(splitIntoParts(["short"], "T")).toHaveLength(1);
    const long = "x".repeat(MAX_PART * 2);
    const parts = splitIntoParts([long], "T");
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.every((p) => p.length <= MAX_PART)).toBe(true);
    expect(parts.join("").replace(/[^x]/g, "").length).toBe(long.length);
  });
});

describe("small helpers", () => {
  it("formats the date in words and cleans phone numbers", () => {
    expect(longDate("2026-11-05")).toBe("05 November 2026");
    expect(cleanPhone("+255 712-345 678")).toBe("255712345678");
    expect(cleanPhone("0712")).toBeNull();
    expect(maskPhone("255712345678")).toBe("2557…678");
  });
});
