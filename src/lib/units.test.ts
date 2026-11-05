import { describe, expect, it } from "vitest";
import { packBreakdown, packagePrice, toBaseQuantity, validateQuantity } from "./units";

describe("toBaseQuantity", () => {
  it("2 cartons of 12 bottles deducts 24 bottles", () => {
    const r = toBaseQuantity(2, 12);
    expect(r.ok && r.value.toString()).toBe("24");
  });

  it("converts drums to litres with decimals exactly", () => {
    const r = toBaseQuantity("1.5", 208.2);
    expect(r.ok && r.value.toString()).toBe("312.3");
  });

  it("rejects a zero or negative factor", () => {
    expect(toBaseQuantity(1, 0).ok).toBe(false);
    expect(toBaseQuantity(1, -12).ok).toBe(false);
  });

  it("rejects a result that would need more than 3 decimal places (no silent rounding)", () => {
    expect(toBaseQuantity("0.001", "0.5").ok).toBe(false);
  });
});

describe("validateQuantity", () => {
  it("accepts whole numbers for whole-only units", () => {
    expect(validateQuantity(3, false).ok).toBe(true);
  });
  it("rejects fractions for whole-only units", () => {
    expect(validateQuantity("2.5", false).ok).toBe(false);
  });
  it("accepts fractions for litres", () => {
    expect(validateQuantity("2.5", true).ok).toBe(true);
  });
  it("rejects zero, negative, junk and over-precise values", () => {
    expect(validateQuantity(0, true).ok).toBe(false);
    expect(validateQuantity(-1, true).ok).toBe(false);
    expect(validateQuantity("abc", true).ok).toBe(false);
    expect(validateQuantity("1.2345", true).ok).toBe(false);
  });
});

describe("packagePrice", () => {
  it("derives price from base price x factor", () => {
    expect(packagePrice(1500, 12).toString()).toBe("18000");
  });
  it("uses the override when present (including zero)", () => {
    expect(packagePrice(1500, 12, 17000).toString()).toBe("17000");
    expect(packagePrice(1500, 12, 0).toString()).toBe("0");
  });
});

describe("packBreakdown", () => {
  const packs = [{ symbol: "ctn", factor: 12 }];
  it("splits into packs plus loose units", () => {
    expect(packBreakdown(41, "btl", packs)).toBe("3 ctn + 5 btl");
  });
  it("shows only packs when it divides evenly", () => {
    expect(packBreakdown(24, "btl", packs)).toBe("2 ctn");
  });
  it("returns null when nothing fits", () => {
    expect(packBreakdown(5, "btl", packs)).toBeNull();
    expect(packBreakdown(5, "btl", [])).toBeNull();
  });
  it("uses the biggest pack that fits", () => {
    expect(packBreakdown(250, "L", [{ symbol: "can", factor: 5 }, { symbol: "drum", factor: 200 }])).toBe("1 drum + 50 L");
  });
});
