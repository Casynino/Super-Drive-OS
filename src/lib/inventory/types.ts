// Plain, serialisable types shared between server pages and client form components.

export type PickerUnit = { id: string; name: string; symbol: string; factor: string; allowsDecimal: boolean };

export type PickerProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  baseUnitId: string;
  /** base unit first (factor "1"), then packaging units */
  units: PickerUnit[];
  /** only filled where a form needs them (the shipment form): current prices per piece and the picture version */
  sellingPrice?: string;
  wholesalePrice?: string | null;
  /** the shipment form: today's selling price of the product's carton (its biggest pack), exact */
  packPrice?: string | null;
  imageV?: number | null;
  /** carton-first: the unit forms start with (null = the biggest pack, else the base unit) and whether single pieces may be sold */
  defaultSalesUnitId?: string | null;
  defaultPurchaseUnitId?: string | null;
  allowPieceSales?: boolean;
};

/** The unit a form should start with for this product: the product's chosen default, else its biggest pack (the carton), else the base unit. */
export function defaultUnitId(p: Pick<PickerProduct, "units" | "baseUnitId" | "defaultSalesUnitId" | "defaultPurchaseUnitId">, kind: "sales" | "purchase"): string {
  const chosen = kind === "sales" ? p.defaultSalesUnitId : p.defaultPurchaseUnitId;
  if (chosen && p.units.some((u) => u.id === chosen)) return chosen;
  const biggest = [...p.units].sort((a, b) => Number(b.factor) - Number(a.factor))[0];
  return biggest && Number(biggest.factor) > 1 ? biggest.id : p.baseUnitId;
}

export type EditorLine = { productId: string; unitId: string; quantity: string; totalCost: string };

export type LocationOption = { id: string; name: string; isDefault: boolean };
