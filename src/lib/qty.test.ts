import { describe, expect, it } from "vitest";
import { inPacks, largestPack, packNote, qtyText } from "./qty";

const ctn = { symbol: "CTN", factor: 12 };

describe("carton quantities (never mixed with pieces)", () => {
  it("writes cartons only", () => {
    expect(qtyText(120, ctn, "PCS")).toEqual({ main: "10 CTN", pieces: null });
    expect(qtyText(0, ctn, "PCS").main).toBe("0 CTN");
  });
  it("shows a leftover as a fraction of a carton instead of hiding it or mixing units", () => {
    expect(qtyText(125, ctn, "PCS").main).toBe("10.42 CTN");
    expect(qtyText(6, ctn, "PCS").main).toBe("0.5 CTN");
  });
  it("uses the product's own carton size, not a fixed 12", () => {
    expect(qtyText(300, { symbol: "CTN", factor: 6 }, "PCS").main).toBe("50 CTN");
    expect(qtyText(1200, { symbol: "CTN", factor: 12 }, "PCS").main).toBe("100 CTN");
  });
  it("keeps the plain base unit when the product has no pack", () => {
    expect(qtyText(41, null, "L")).toEqual({ main: "41 L", pieces: null });
  });
  it("shows pieces when the CTN | PCS switch is on PCS", () => {
    expect(qtyText(125, ctn, "PCS", "pcs").main).toBe("125 PCS");
    expect(qtyText(120, ctn, "PCS", "ctn").main).toBe("10 CTN");
  });
  it("says how many pieces one carton holds", () => {
    expect(packNote(ctn, "PCS")).toBe("1 CTN = 12 PCS");
    expect(packNote(null, "PCS")).toBeNull();
  });
  it("finds the biggest pack and counts packs for totals", () => {
    expect(largestPack([{ symbol: "BOX", factor: "6" }, { symbol: "CTN", factor: "12" }, { symbol: "PCS", factor: "1" }])).toEqual({ symbol: "CTN", factor: 12 });
    expect(largestPack([{ symbol: "PCS", factor: "1" }])).toBeNull();
    expect(inPacks(30, ctn)).toBe(2.5);
  });
});
