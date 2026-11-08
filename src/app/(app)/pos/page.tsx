import Link from "next/link";
import { randomUUID } from "node:crypto";
import { EmptyState } from "@/components/ui";
import { BannerBell, bannerDate } from "@/components/BannerBell";
import BannerTheme from "@/components/BannerTheme";
import PosTerminal from "@/components/pos/PosTerminal";
import { getUnitMode } from "@/lib/unit-mode";
import { can } from "@/lib/auth/can";
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
      <section className="relative mb-5 overflow-hidden rounded-2xl bg-[#0a1a33] text-white shadow-[0_10px_30px_-14px_rgba(5,22,39,0.7)] ring-1 ring-white/10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_220px_at_88%_55%,rgba(47,111,208,0.42),transparent_62%)]" aria-hidden />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(520px_170px_at_50%_0%,rgba(253,196,0,0.10),transparent_72%)]" aria-hidden />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/banner-products.webp" alt="" aria-hidden className="pointer-events-none absolute bottom-0 right-0 hidden h-full w-auto max-w-[32%] select-none object-contain object-right-bottom lg:block" />
        {/* the bell and the night / light look: small icons at the left side, in the middle (a phone has them in its own top bar and menu) */}
        <div className="absolute left-6 top-1/2 z-10 flex -translate-y-1/2 items-center gap-2">
          <BannerBell userId={user.id} className="relative h-8 w-8" />
          <BannerTheme className="h-8 w-8" />
        </div>
        <div className="relative flex min-h-[7.5rem] flex-col items-center justify-center px-5 py-5 text-center">
          {/* the person's name, big, and under it his position (Nino 2026-11-08), then the date */}
          <h1 className="flex max-w-full items-center gap-4 text-3xl font-semibold uppercase tracking-[0.35em] text-white sm:text-4xl">
            <span className="hidden h-px w-10 shrink-0 bg-oil-400/60 sm:block" aria-hidden />
            <span className="min-w-0 truncate pl-[0.35em]">{user.name.trim().split(/\s+/)[0]}</span>
            <span className="hidden h-px w-10 shrink-0 bg-oil-400/60 sm:block" aria-hidden />
          </h1>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-oil-400">{user.roleName}</p>
          {/* the date, small, under the position */}
          <p className="mt-1.5 text-sm text-white/65" suppressHydrationWarning>
            {bannerDate()}
          </p>
        </div>
      </section>
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
