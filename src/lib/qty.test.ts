import { describe, expect, it } from "vitest";
import { inPacks, largestPack, packNote, qtyText } from "./qty";

const ctn = { symbol: "CTN", factor: 12 };

describe("carton quantities (cartons first, the loose pieces of an opened carton after them)", () => {
  it("writes whole cartons only when the carton is full", () => {
    expect(qtyText(120, ctn, "PCS")).toEqual({ main: "10 CTN", pieces: null });
    expect(qtyText(0, ctn, "PCS").main).toBe("0 PCS");
  });
  it("shows the loose pieces of an opened carton after the cartons", () => {
    expect(qtyText(125, ctn, "PCS").main).toBe("10 CTN + 5 PCS");
    expect(qtyText(6, ctn, "PCS").main).toBe("6 PCS");
    expect(qtyText(14, { symbol: "CTN", factor: 4 }, "PCS").main).toBe("3 CTN + 2 PCS");
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
