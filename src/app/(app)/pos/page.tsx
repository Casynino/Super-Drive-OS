import Link from "next/link";
import { randomUUID } from "node:crypto";
import { EmptyState, PageHeader } from "@/components/ui";
import PosTerminal from "@/components/pos/PosTerminal";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { outstandingByCustomer } from "@/lib/sales/outstanding";
import { listPrice } from "@/lib/sales/pricing";
import type { PosCustomer, PosProduct } from "@/lib/sales/types";
import { getCurrency } from "@/lib/settings";
import { createSale } from "./actions";
import { quickCreateCustomer } from "../customers/actions";
import { getActiveLocations, getStockByLocation } from "../inventory/data";

export const metadata = { title: "Point of sale" };

export default async function PosPage() {
  const user = await requirePagePermission("sales.pos");
  const canCredit = can(user, "sales.credit");

  const [products, locations, stockByLocation, customers, owed, currency] = await Promise.all([
    db.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      include: { baseUnit: true, brand: { select: { name: true } }, category: { select: { id: true, name: true } }, image: { select: { updatedAt: true } }, units: { include: { unit: true }, orderBy: { factor: "asc" } } },
    }),
    getActiveLocations(),
    getStockByLocation(),
    can(user, "customers.view") ? db.customer.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, take: 3000 }) : [],
    canCredit ? outstandingByCustomer(db) : new Map(),
    getCurrency(),
  ]);

  // Prices are worked out here from the database; the browser only displays them (the server recomputes on sale).
  const posProducts: PosProduct[] = products.map((p) => {
    const priced = (id: string, name: string, symbol: string, allowsDecimal: boolean, factor: Prisma.Decimal, sel: Prisma.Decimal | null, whl: Prisma.Decimal | null) => {
      const inputs = { factor, basePrice: p.sellingPrice, baseWholesale: p.wholesalePrice, unitSelling: sel, unitWholesale: whl };
      return { id, name, symbol, allowsDecimal, factor: factor.toString(), retail: listPrice(inputs, false).toString(), wholesale: listPrice(inputs, true).toString() };
    };
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      baseUnitId: p.baseUnitId,
      brand: p.brand?.name ?? null,
      categoryId: p.category.id,
      categoryName: p.category.name,
      packaging: p.packagingType,
      imageV: p.image ? p.image.updatedAt.getTime() : null,
      units: [
        priced(p.baseUnit.id, p.baseUnit.name, p.baseUnit.symbol, p.baseUnit.allowsDecimal, new Prisma.Decimal(1), null, null),
        ...p.units.map((u) => priced(u.unit.id, u.unit.name, u.unit.symbol, u.unit.allowsDecimal, u.factor, u.sellingPrice, u.wholesalePrice)),
      ],
    };
  });

  const posCustomers: PosCustomer[] = customers.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    type: c.type,
    ...(canCredit ? { creditLimit: c.creditLimit.toString(), outstanding: (owed.get(c.id) ?? 0).toString() } : {}),
  }));

  return (
    <>
      <PageHeader title="Point of sale" description="Search or scan a product, set the quantity, and take payment." />
      {posProducts.length === 0 || locations.length === 0 ? (
        <div className="card">
          <EmptyState
            title={posProducts.length === 0 ? "No products to sell yet" : "No stock location"}
            description="Add products and receive stock before selling."
            action={
              <Link href="/products" className="btn-primary">
                Go to products
              </Link>
            }
          />
        </div>
      ) : (
        <PosTerminal
          action={createSale}
          quickAddCustomer={quickCreateCustomer}
          products={posProducts}
          locations={locations}
          stockByLocation={stockByLocation}
          customers={posCustomers}
          submissionKey={randomUUID()}
          currency={currency}
          perms={{ credit: canCredit, discount: can(user, "sales.discount"), addCustomer: can(user, "customers.create"), creditException: can(user, "credit.approve_exception") }}
        />
      )}
    </>
  );
}
