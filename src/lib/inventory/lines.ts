import { Prisma } from "@/generated/prisma/client";
import { toBaseQuantity, validateQuantity } from "@/lib/units";
import type { Tx } from "./engine";

const D = Prisma.Decimal;

export type RawLine = { productId: string; unitId: string; quantity: string; totalCost?: string };

export type ResolvedLine = {
  index: number;
  productId: string;
  productName: string;
  avgCost: Prisma.Decimal;
  purchasePrice: Prisma.Decimal;
  /** selling prices, used by sales: per BASE unit, plus optional per-packaging-unit overrides */
  basePrice: Prisma.Decimal;
  baseWholesale: Prisma.Decimal | null;
  unitSelling: Prisma.Decimal | null;
  unitWholesale: Prisma.Decimal | null;
  enteredQty: Prisma.Decimal;
  enteredUnitId: string;
  factor: Prisma.Decimal;
  /** quantity converted to base units */
  quantity: Prisma.Decimal;
};

export type ResolveResult = { ok: true; lines: ResolvedLine[] } | { ok: false; errors: Record<number, string>; message: string };

/**
 * Turns what the form sent (product, unit, quantity) into trusted values: the factor always comes from the
 * database, never from the browser. Rejects inactive products, units that don't belong to the product,
 * fractions on whole-number units, and duplicate products in one document.
 */
export async function resolveLines(
  tx: Pick<Tx, "product">,
  raw: RawLine[],
  opts: { allowZero?: boolean; /** sales: the same product may appear on several lines if the units differ */ perProductUnit?: boolean } = {},
): Promise<ResolveResult> {
  const errors: Record<number, string> = {};
  if (raw.length === 0) return { ok: false, errors, message: "Add at least one product." };
  if (raw.length > 200) return { ok: false, errors, message: "Too many lines in one document (max 200)." };

  const products = await tx.product.findMany({
    where: { id: { in: raw.map((l) => l.productId) } },
    include: { baseUnit: true, units: { include: { unit: true } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const lines: ResolvedLine[] = [];

  raw.forEach((l, i) => {
    const p = byId.get(l.productId);
    if (!p) return void (errors[i] = "Choose a product.");
    if (p.status !== "ACTIVE") return void (errors[i] = `${p.name} is inactive.`);
    const dupKey = opts.perProductUnit ? `${p.id}:${l.unitId}` : p.id;
    if (seen.has(dupKey)) return void (errors[i] = `${p.name} appears more than once${opts.perProductUnit ? " in the same unit" : ""}. Combine it into one line.`);
    seen.add(dupKey);

    let factor = new D(1);
    let allowsDecimal = p.baseUnit.allowsDecimal;
    let unitSelling: Prisma.Decimal | null = null;
    let unitWholesale: Prisma.Decimal | null = null;
    if (l.unitId !== p.baseUnitId) {
      const pu = p.units.find((u) => u.unitId === l.unitId);
      if (!pu) return void (errors[i] = `That unit is not set up for ${p.name}.`);
      factor = pu.factor;
      allowsDecimal = pu.unit.allowsDecimal;
      unitSelling = pu.sellingPrice;
      unitWholesale = pu.wholesalePrice;
    }

    const qtyRaw = l.quantity.trim();
    let entered: Prisma.Decimal;
    if (opts.allowZero && /^0+(\.0+)?$/.test(qtyRaw)) {
      entered = new D(0);
    } else {
      const q = validateQuantity(qtyRaw, allowsDecimal);
      if (!q.ok) return void (errors[i] = q.error);
      entered = q.value;
    }
    const base = toBaseQuantity(entered, factor);
    if (!base.ok) return void (errors[i] = base.error);

    lines.push({
      index: i,
      productId: p.id,
      productName: p.name,
      avgCost: p.avgCost,
      purchasePrice: p.purchasePrice,
      basePrice: p.sellingPrice,
      baseWholesale: p.wholesalePrice,
      unitSelling,
      unitWholesale,
      enteredQty: entered,
      enteredUnitId: l.unitId,
      factor,
      quantity: base.value,
    });
  });

  if (Object.keys(errors).length) return { ok: false, errors, message: "Please fix the highlighted lines." };
  return { ok: true, lines };
}
