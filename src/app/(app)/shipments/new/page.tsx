import { randomUUID } from "node:crypto";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import ShipmentForm from "@/components/shipments/ShipmentForm";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getCurrency } from "@/lib/settings";
import { getActiveLocations, getPickerProducts } from "../../inventory/data";
import { announceShipment, createProductForShipment } from "../actions";

export const metadata = { title: "New shipment" };

export default async function NewShipmentPage() {
  const user = await requirePagePermission("shipments.manage");
  const canPrice = can(user, "products.price");
  const [picker, extras, locations, suppliers, categories, brands, currency] = await Promise.all([
    getPickerProducts(),
    // current prices and picture versions, so each line starts from today's selling price (prices are only read for people who may set them)
    db.product.findMany({ where: { status: "ACTIVE" }, select: { id: true, sellingPrice: true, wholesalePrice: true, image: { select: { updatedAt: true } } } }),
    getActiveLocations(),
    db.supplier.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.category.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.brand.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getCurrency(),
  ]);
  const extra = new Map(extras.map((e) => [e.id, e]));
  const products = picker.map((p) => {
    const e = extra.get(p.id);
    return { ...p, sellingPrice: canPrice ? e?.sellingPrice.toString() : undefined, wholesalePrice: canPrice ? (e?.wholesalePrice?.toString() ?? null) : null, imageV: e?.image ? e.image.updatedAt.getTime() : null };
  });

  return (
    <>
      <PageHeader title="New shipment" description="Write down the stock you bought. It goes on the way to the shop, and they mark it arrived and check it when it lands." back={{ href: "/shipments", label: "Incoming stock" }} />
      {locations.length === 0 ? (
        <div className="card">
          <EmptyState title="Add a stock location first" action={<Link href="/settings" className="btn-primary">Open settings</Link>} />
        </div>
      ) : (
        <ShipmentForm
          action={announceShipment}
          createProduct={createProductForShipment}
          products={products}
          locations={locations}
          suppliers={suppliers}
          categories={categories}
          brands={brands}
          canPrice={canPrice}
          currencySymbol={currency.symbol}
          submissionKey={randomUUID()}
        />
      )}
    </>
  );
}
