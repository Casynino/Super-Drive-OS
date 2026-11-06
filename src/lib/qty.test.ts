import { describe, expect, it } from "vitest";
import { inPacks, largestPack, qtyText } from "./qty";

const ctn = { symbol: "CTN", factor: 12 };

describe("carton-first quantities", () => {
  it("writes whole cartons, cartons plus pieces, and loose pieces", () => {
    expect(qtyText(120, ctn, "PCS")).toEqual({ main: "10 CTN", pieces: "120 PCS" });
    expect(qtyText(125, ctn, "PCS")).toEqual({ main: "10 CTN + 5 PCS", pieces: "125 PCS" });
    expect(qtyText(5, ctn, "PCS")).toEqual({ main: "5 PCS", pieces: null });
    expect(qtyText(0, ctn, "PCS")).toEqual({ main: "0 PCS", pieces: null });
  });
  it("uses the product's own carton size, not a fixed 12", () => {
    expect(qtyText(300, { symbol: "CTN", factor: 6 }, "PCS").main).toBe("50 CTN");
    expect(qtyText(1200, { symbol: "CTN", factor: 12 }, "PCS").main).toBe("100 CTN");
  });
  it("keeps the plain base unit when the product has no pack", () => {
    expect(qtyText(41, null, "L")).toEqual({ main: "41 L", pieces: null });
  });
  it("finds the biggest pack and counts packs for totals", () => {
    expect(largestPack([{ symbol: "BOX", factor: "6" }, { symbol: "CTN", factor: "12" }, { symbol: "PCS", factor: "1" }])).toEqual({ symbol: "CTN", factor: 12 });
    expect(largestPack([{ symbol: "PCS", factor: "1" }])).toBeNull();
    expect(inPacks(30, ctn)).toBe(2.5);
  });
});
