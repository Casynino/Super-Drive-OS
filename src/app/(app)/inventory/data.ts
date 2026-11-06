import { db } from "@/lib/db";
import type { LocationOption, PickerProduct } from "@/lib/inventory/types";

/** Active products shaped for the client-side product picker (base unit first, then packaging units). */
export async function getPickerProducts(): Promise<PickerProduct[]> {
  const products = await db.product.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    include: { baseUnit: true, units: { include: { unit: true }, orderBy: { factor: "asc" } } },
  });
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    baseUnitId: p.baseUnitId,
    defaultSalesUnitId: p.defaultSalesUnitId,
    defaultPurchaseUnitId: p.defaultPurchaseUnitId,
    allowPieceSales: p.allowPieceSales,
    units: [
      { id: p.baseUnit.id, name: p.baseUnit.name, symbol: p.baseUnit.symbol, factor: "1", allowsDecimal: p.baseUnit.allowsDecimal },
      ...p.units.map((u) => ({ id: u.unit.id, name: u.unit.name, symbol: u.unit.symbol, factor: u.factor.toString(), allowsDecimal: u.unit.allowsDecimal })),
    ],
  }));
}

export async function getActiveLocations(): Promise<LocationOption[]> {
  const rows = await db.location.findMany({ where: { status: "ACTIVE", type: { not: "RESELLER" } }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isDefault: true } });
  return rows;
}

/** { locationId: { productId: available } } for what can still be sold or moved (physical stock minus what is reserved for collection); used for "on hand" hints in forms and the POS. */
export async function getStockByLocation(): Promise<Record<string, Record<string, string>>> {
  const rows = await db.stockBalance.findMany({ where: { quantity: { gt: 0 } }, select: { productId: true, locationId: true, quantity: true, reserved: true } });
  const out: Record<string, Record<string, string>> = {};
  for (const r of rows) {
    const available = r.quantity.minus(r.reserved);
    if (available.gt(0)) (out[r.locationId] ??= {})[r.productId] = available.toString();
  }
  return out;
}

/** Today's date (YYYY-MM-DD) in the business time zone. */
export function todayInBusinessTz() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
}
