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

export const metadata = { title: "Announce shipment" };

export default async function NewShipmentPage() {
  const user = await requirePagePermission("shipments.manage");
  const [products, locations, suppliers, categories, brands, currency] = await Promise.all([
    getPickerProducts(),
    getActiveLocations(),
    db.supplier.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.category.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.brand.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getCurrency(),
  ]);

  return (
    <>
      <PageHeader title="Announce a shipment" description="Tell the shop what is coming. Stock only increases when the shop counts and confirms it." back={{ href: "/shipments", label: "Incoming stock" }} />
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
          canPrice={can(user, "products.price")}
          currencySymbol={currency.symbol}
          submissionKey={randomUUID()}
        />
      )}
    </>
  );
}
