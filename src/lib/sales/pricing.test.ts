import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { isWholesaleType, listPrice } from "./pricing";

const D = (v: string | number) => new Prisma.Decimal(v);
const base = { factor: D(1), basePrice: D(25000), baseWholesale: D(22000), unitSelling: null, unitWholesale: null };
const carton = { ...base, factor: D(12) };

describe("listPrice", () => {
  it("retail base unit uses the base price", () => {
    expect(listPrice(base, false).toString()).toBe("25000");
  });
  it("a carton is base price x factor unless it has its own price", () => {
    expect(listPrice(carton, false).toString()).toBe("300000");
    expect(listPrice({ ...carton, unitSelling: D(290000) }, false).toString()).toBe("290000");
  });
  it("wholesale uses wholesale prices, and falls back to retail when none is set", () => {
    expect(listPrice(base, true).toString()).toBe("22000");
    expect(listPrice(carton, true).toString()).toBe("264000");
    expect(listPrice({ ...carton, unitWholesale: D(260000) }, true).toString()).toBe("260000");
    expect(listPrice({ ...base, baseWholesale: null }, true).toString()).toBe("25000");
  });
});

describe("isWholesaleType", () => {
  it("only wholesale and distributor customers get wholesale prices", () => {
    expect(isWholesaleType("WHOLESALE")).toBe(true);
    expect(isWholesaleType("DISTRIBUTOR")).toBe(true);
    expect(isWholesaleType("RETAIL")).toBe(false);
    expect(isWholesaleType(null)).toBe(false);
  });
});
