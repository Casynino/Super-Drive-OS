// Damaged pieces that can still be sold go into their own "(damaged packaging)" product with its own lower price and stock,
// so the normal product and its price are never touched and the two can never be mixed up at the till.
// Used by the investigation of a received order (issues.ts) and by problems reported by hand (problems.ts).
// Call inside db.$transaction. Lock order: products (original, then variant) -> balances.
import { Prisma } from "@/generated/prisma/client";
import { applyIncomingCost, lockProducts, type Tx } from "@/lib/inventory/engine";
import { moveStockTracked } from "@/lib/inventory/items";
import { parseMoney } from "@/lib/money";
import { ShipmentError } from "./engine";

type Dec = Prisma.Decimal;

export async function putOnDiscount(
  tx: Tx,
  i: {
    productId: string;
    qty: Dec;
    /** the new selling price per carton (per piece when the product has no carton), as typed */
    discountPrice: string;
    unitCost: Dec;
    locationId: string;
    currencyDecimals: number;
    user: { id: string };
    referenceType: string;
    referenceId: string;
    referenceNo: string;
    /** shown in the stock movement of the new product */
    reason: string;
    /** marks the original damaged pieces as disposed (they moved into the discount product) */
    disposeOriginal: (variantName: string) => Promise<void>;
  },
): Promise<{ variantProductId: string; variantName: string; perBase: Dec }> {
  const orig = await tx.product.findUniqueOrThrow({ where: { id: i.productId }, include: { units: true } });
  const pack = [...orig.units].filter((u) => u.factor.gt(1)).sort((a, b) => b.factor.comparedTo(a.factor))[0] ?? null;
  const typed = parseMoney(i.discountPrice ?? "", i.currencyDecimals);
  if (!typed || typed.lte(0)) throw new ShipmentError("Enter the discounted selling price.", { discountPrice: "Enter a price above zero." });
  const normal = pack ? (pack.sellingPrice ?? orig.sellingPrice.mul(pack.factor)) : orig.sellingPrice;
  if (typed.gte(normal)) throw new ShipmentError("The discounted price must be lower than the normal price.", { discountPrice: `Lower than the normal ${normal.toFixed(0)}.` });
  const perBase = (pack ? typed.div(pack.factor) : typed).toDecimalPlaces(2);
  const sku = `${orig.sku}-DMG`;
  let variant = await tx.product.findUnique({ where: { sku }, include: { units: true } });
  if (!variant) {
    variant = await tx.product.create({
      data: {
        sku,
        name: `${orig.name} (damaged packaging)`,
        description: `Same oil as ${orig.name}, packaging damaged, sold at a discount.`,
        categoryId: orig.categoryId,
        brandId: orig.brandId,
        packagingType: orig.packagingType,
        size: orig.size,
        baseUnitId: orig.baseUnitId,
        defaultSalesUnitId: orig.defaultSalesUnitId,
        defaultPurchaseUnitId: orig.defaultPurchaseUnitId,
        allowPieceSales: orig.allowPieceSales,
        purchasePrice: orig.purchasePrice,
        sellingPrice: perBase,
        createdById: i.user.id,
        units: { create: orig.units.map((u) => ({ unitId: u.unitId, factor: u.factor, sellingPrice: pack && u.unitId === pack.unitId ? typed : null })) },
      },
      include: { units: true },
    });
    await tx.productPriceHistory.create({ data: { productId: variant.id, field: "sellingPrice", oldValue: null, newValue: perBase, changedById: i.user.id } });
  } else if (!variant.sellingPrice.eq(perBase)) {
    // asked again with another price: the product follows the newest price
    await tx.productPriceHistory.create({ data: { productId: variant.id, field: "sellingPrice", oldValue: variant.sellingPrice, newValue: perBase, changedById: i.user.id } });
    await tx.product.update({ where: { id: variant.id }, data: { sellingPrice: perBase, status: "ACTIVE" } });
    if (pack) await tx.productUnit.updateMany({ where: { productId: variant.id, unitId: pack.unitId }, data: { sellingPrice: typed } });
  }
  await lockProducts(tx, [orig.id, variant.id]);
  await applyIncomingCost(tx, variant.id, i.qty, i.unitCost);
  await moveStockTracked(tx, { productId: variant.id, locationId: i.locationId, type: "ADJUSTMENT", delta: i.qty, unitCost: i.unitCost, referenceType: i.referenceType, referenceId: i.referenceId, referenceNo: i.referenceNo, reason: i.reason, userId: i.user.id });
  await i.disposeOriginal(variant.name);
  return { variantProductId: variant.id, variantName: variant.name, perBase };
}
