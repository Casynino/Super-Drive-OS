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
};

export type EditorLine = { productId: string; unitId: string; quantity: string; totalCost: string };

export type LocationOption = { id: string; name: string; isDefault: boolean };
