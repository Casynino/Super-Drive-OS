import { randomUUID } from "node:crypto";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import OrderForm, { type OrderDraftState } from "@/components/shipments/OrderForm";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getCurrency } from "@/lib/settings";
import { getActiveLocations, getPickerProducts } from "../../inventory/data";
import { announceShipment, createProductForShipment, saveOrderDraft } from "../actions";

export const metadata = { title: "New order" };

export default async function NewShipmentPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const user = await requirePagePermission("shipments.manage");
  const sp = await searchParams;
  const canPrice = can(user, "products.price");
  const [picker, extras, packRows, locations, suppliers, categories, brands, currency, cargoRows, perCategory, draftRow, recentRows] = await Promise.all([
    getPickerProducts(),
    // current prices and picture versions, so each line starts from today's selling price (prices are only read for people who may set them)
    db.product.findMany({ where: { status: "ACTIVE" }, select: { id: true, sellingPrice: true, wholesalePrice: true, categoryId: true, category: { select: { name: true } }, image: { select: { updatedAt: true } } } }),
    db.productUnit.findMany({ where: { product: { status: "ACTIVE" }, factor: { gt: 1 } }, select: { productId: true, unitId: true, factor: true, sellingPrice: true } }),
    getActiveLocations(),
    db.supplier.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.category.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.brand.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getCurrency(),
    db.shipment.findMany({ where: { cargoName: { not: null } }, distinct: ["cargoName"], orderBy: { createdAt: "desc" }, take: 20, select: { cargoName: true } }),
    db.product.groupBy({ by: ["categoryId"], _count: { _all: true }, orderBy: { _count: { categoryId: "desc" } }, take: 1 }),
    sp.draft ? db.shipmentDraft.findFirst({ where: { id: sp.draft, createdById: user.id } }) : null,
    // the products on the latest orders, newest first: the picker offers them first
    db.shipmentItem.findMany({ where: { unexpected: false }, orderBy: { shipment: { createdAt: "desc" } }, distinct: ["productId"], take: 8, select: { productId: true } }),
  ]);
  const extra = new Map(extras.map((e) => [e.id, e]));
  // the carton price of each product: its biggest pack's own price when it has one
  const biggestPack = new Map<string, (typeof packRows)[number]>();
  for (const r of packRows) {
    const cur = biggestPack.get(r.productId);
    if (!cur || Number(r.factor) > Number(cur.factor)) biggestPack.set(r.productId, r);
  }
  const products = picker.map((p) => {
    const e = extra.get(p.id);
    const pack = biggestPack.get(p.id);
    return {
      ...p,
      sellingPrice: canPrice ? e?.sellingPrice.toString() : undefined,
      wholesalePrice: canPrice ? (e?.wholesalePrice?.toString() ?? null) : null,
      packPrice: canPrice && pack?.sellingPrice ? pack.sellingPrice.toString() : null,
      imageV: e?.image ? e.image.updatedAt.getTime() : null,
      categoryId: e?.categoryId,
      categoryName: e?.category.name,
    };
  });

  const data = draftRow?.data as Partial<OrderDraftState> | null | undefined;
  const draft =
    draftRow && data && data.v === 1 && Array.isArray(data.lines)
      ? { id: draftRow.id, savedAt: draftRow.updatedAt.toISOString(), state: { v: 1 as const, lines: data.lines, supplierText: data.supplierText ?? "", cargoName: data.cargoName ?? "", expectedDate: data.expectedDate ?? "", locationId: data.locationId ?? "", notes: data.notes ?? "" } }
      : null;

  return (
    <>
      <PageHeader title="New order" description="Pick what you bought. Save it and finish later, or send it to the shop." back={{ href: "/shipments", label: "Orders" }} />
      {locations.length === 0 ? (
        <div className="card">
          <EmptyState title="Add a stock location first" action={<Link href="/settings" className="btn-primary">Open settings</Link>} />
        </div>
      ) : (
        <OrderForm
          action={announceShipment}
          createProduct={createProductForShipment}
          saveDraft={saveOrderDraft}
          products={products}
          locations={locations}
          suppliers={suppliers}
          canAddSupplier={can(user, "suppliers.manage")}
          categories={categories}
          brands={brands}
          defaultCategoryId={perCategory[0]?.categoryId ?? categories[0]?.id ?? ""}
          recentIds={recentRows.map((r) => r.productId)}
          cargoNames={cargoRows.map((c) => c.cargoName!).filter(Boolean)}
          canPrice={canPrice}
          currencySymbol={currency.symbol}
          submissionKey={randomUUID()}
          draft={draft}
        />
      )}
    </>
  );
}
