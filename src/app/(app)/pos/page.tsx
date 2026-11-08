import Link from "next/link";
import { randomUUID } from "node:crypto";
import { EmptyState } from "@/components/ui";
import HomeBanner from "@/components/HomeBanner";
import QuickIcons from "@/components/QuickIcons";
import { CalendarCheck, Handshake, LayoutDashboard, Receipt, ReceiptText, Users } from "lucide-react";
import PosTerminal from "@/components/pos/PosTerminal";
import { getUnitMode } from "@/lib/unit-mode";
import { can, canAny } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { openOrdersByCustomer, outstandingByCustomer, overdueByCustomer } from "@/lib/sales/outstanding";
import { listPrice } from "@/lib/sales/pricing";
import type { PosCustomer, PosProduct } from "@/lib/sales/types";
import { listAccounts } from "@/lib/cash/ledger";
import { getCurrency } from "@/lib/settings";
import { createSale } from "./actions";
import { quickCreateCustomer } from "../customers/actions";
import { quickCreateWinga } from "../resellers/actions";
import { getActiveLocations, getStockByLocation } from "../inventory/data";

export const metadata = { title: "Home" };

export default async function PosPage({ searchParams }: { searchParams: Promise<{ winga?: string }> }) {
  const sp = await searchParams;
  const user = await requirePagePermission("sales.pos");
  const canCredit = can(user, "sales.credit");

  const [products, locations, stockByLocation, customers, owed, late, orderCounts, currency, accounts] = await Promise.all([
    db.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      include: { baseUnit: true, brand: { select: { name: true } }, category: { select: { id: true, name: true } }, image: { select: { updatedAt: true } }, units: { include: { unit: true }, orderBy: { factor: "asc" } } },
    }),
    getActiveLocations(),
    getStockByLocation(),
    can(user, "customers.view") ? db.customer.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, take: 3000, include: { reseller: { select: { id: true } } } }) : [],
    canCredit ? outstandingByCustomer(db) : new Map(),
    canCredit ? overdueByCustomer(db) : new Map(),
    canCredit ? openOrdersByCustomer(db) : new Map(),
    getCurrency(),
    listAccounts(db),
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
      defaultSalesUnitId: p.defaultSalesUnitId,
      defaultPurchaseUnitId: p.defaultPurchaseUnitId,
      allowPieceSales: p.allowPieceSales,
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
    winga: Boolean(c.reseller),
    ...(c.reseller ? { wingaId: c.reseller.id } : {}),
    complete: Boolean(c.phone?.trim() && c.idNumber?.trim() && c.businessLocation?.trim()),
    ...(late.get(c.id) ? { late: { amount: late.get(c.id)!.amount.toString(), since: late.get(c.id)!.since.toISOString().slice(0, 10) } } : {}),
    ...(canCredit ? { creditLimit: c.creditLimit.toString(), outstanding: (owed.get(c.id) ?? 0).toString(), openOrders: orderCounts.get(c.id) ?? 0 } : {}),
  }));

  // the shop person's home: a small banner like the Director's, with the words in the middle and the shop's real products at the side
  return (
    <>
      <HomeBanner user={user} />
      {/* the same plain icon row as the other homes, on a phone and tablet (the till needs the room on a computer) */}
      <QuickIcons
        fill
        className="mb-4 lg:hidden"
        items={[
          { href: "/overview", label: "Today", icon: LayoutDashboard },
          canAny(user, ["sales.view_own", "sales.view_all"]) && { href: "/sales", label: "Sales", icon: Receipt },
          can(user, "resellers.view") && { href: "/resellers", label: "Winga", icon: Handshake },
          can(user, "customers.view") && { href: "/customers", label: "Customers", icon: Users },
          canAny(user, ["expenses.view", "expenses.create"]) && { href: "/expenses", label: "Expenses", icon: ReceiptText },
          can(user, "closing.submit") && { href: "/closing", label: "Close", icon: CalendarCheck },
        ].filter((x): x is { href: string; label: string; icon: typeof Receipt } => Boolean(x))}
      />
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
          quickAddWinga={quickCreateWinga}
          initialWingaId={sp.winga}
          products={posProducts}
          locations={locations}
          stockByLocation={stockByLocation}
          customers={posCustomers}
          submissionKey={randomUUID()}
          unitMode={await getUnitMode()}
          currency={currency}
          accounts={accounts.map((a) => ({ id: a.id, locationId: a.locationId, method: a.method, name: a.name, accountNumber: a.accountNumber, isDefault: a.isDefault }))}
          perms={{ credit: canCredit, discount: can(user, "sales.discount"), addCustomer: can(user, "customers.create"), addWinga: can(user, "resellers.operate") || can(user, "resellers.manage"), collect: can(user, "payments.record"), returns: can(user, "returns.create"), viewWinga: can(user, "resellers.view"), viewCustomer: can(user, "customers.view"), creditException: can(user, "credit.approve_exception") }}
        />
      )}
    </>
  );
}
