import { describe, expect, it } from "vitest";
import { drawBarcode, ean13CheckDigit, internalBarcode, isEan13 } from "./barcode";
import { generateSku } from "./product-codes";

describe("barcodes", () => {
  it("computes the EAN-13 check digit (known real codes)", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1); // 4006381333931
    expect(isEan13("4006381333931")).toBe(true);
    expect(isEan13("4006381333932")).toBe(false);
    expect(isEan13("12345")).toBe(false);
  });

  it("makes the shop's own numbers: valid, in the in-store range, and different for every product", () => {
    expect(internalBarcode(1)).toBe("2000000000015");
    const codes = new Set(Array.from({ length: 5000 }, (_, i) => internalBarcode(i + 1)));
    expect(codes.size).toBe(5000);
    for (const c of [...codes].slice(0, 200)) {
      expect(isEan13(c)).toBe(true);
      expect(c.startsWith("200")).toBe(true);
    }
    expect(() => internalBarcode(0)).toThrow();
  });

  it("draws 95 modules with the guard bars in the right places", () => {
    const d = drawBarcode("4006381333931")!;
    expect(d.kind).toBe("ean13");
    expect(d.modules).toHaveLength(95);
    expect(d.modules.startsWith("101")).toBe(true);
    expect(d.modules.endsWith("101")).toBe(true);
    expect(d.modules.slice(45, 50)).toBe("01010"); // centre guard
    // a 12-digit UPC-A is the same bars as EAN-13 with a leading zero
    expect(drawBarcode("036000291452")!.digits).toBe("0036000291452");
    expect(drawBarcode("96385074")!.modules).toHaveLength(67); // EAN-8
    expect(drawBarcode("not a code")).toBeNull();
    expect(drawBarcode("4006381333932")).toBeNull(); // wrong check digit is never drawn
  });
});

describe("product codes from names", () => {
  it("builds a readable code from the brand and the name", () => {
    expect(generateSku("Castrol 15W-40 5L", "Castrol")).toBe("CAS-15W40-5L");
    expect(generateSku("Total 20W-50 1L", "Total")).toBe("TOT-20W50-1L");
    expect(generateSku("Nissan 5W-30 NS 4L", "Nissan")).toBe("NIS-5W30-NS-4L");
    expect(generateSku("15W-40 5L", "Castrol")).toBe("CAS-15W40-5L"); // brand not in the name
    expect(generateSku("Hydraulic Oil 46 20L")).toBe("HYD-OIL-46-20L"); // no brand: first word
    expect(generateSku("***")).toBe("ITEM");
    expect(generateSku("A very long product name that keeps going and going and going", null).length).toBeLessThanOrEqual(32);
  });
});
