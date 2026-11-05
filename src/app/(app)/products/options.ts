import { db } from "@/lib/db";
import { getCurrency } from "@/lib/settings";

/** Active categories / brands / units for the product form (plus the inactive ones already used by the product being edited). */
export async function getProductFormOptions(include?: { categoryId?: string; brandId?: string; unitIds?: string[] }) {
  const [categories, brands, units, currency] = await Promise.all([
    db.category.findMany({
      where: { OR: [{ status: "ACTIVE" }, ...(include?.categoryId ? [{ id: include.categoryId }] : [])] },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.brand.findMany({
      where: { OR: [{ status: "ACTIVE" }, ...(include?.brandId ? [{ id: include.brandId }] : [])] },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.unit.findMany({
      where: { OR: [{ status: "ACTIVE" }, ...(include?.unitIds?.length ? [{ id: { in: include.unitIds } }] : [])] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, symbol: true, allowsDecimal: true },
    }),
    getCurrency(),
  ]);
  return { categories, brands, units, currency };
}
