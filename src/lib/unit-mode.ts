import type { UnitMode } from "@/lib/qty";

/**
 * Cartons are the default everywhere. There is no whole-system switch any more (Nino: "on the product, not the whole system"):
 * each product has its own CTN | PCS switch (`QtySwitch`) that changes only that product's numbers on the screen.
 * Kept as one function so every screen still asks the same place.
 */
export async function getUnitMode(): Promise<UnitMode> {
  return "ctn";
}
