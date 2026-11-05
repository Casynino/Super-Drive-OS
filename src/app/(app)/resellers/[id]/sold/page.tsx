import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { PageHeader } from "@/components/ui";
import ResellerStockForm from "@/components/resellers/ResellerStockForm";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getResellerProducts } from "@/lib/resellers/engine";
import { getCurrency } from "@/lib/settings";
import { getActiveLocations, getPickerProducts, getStockByLocation } from "../../../inventory/data";
import { reportSoldAction } from "../../actions";

export const metadata = { title: "Record what a reseller sold" };

export default async function SoldPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("resellers.operate");
  const { id } = await params;
  const r = await db.reseller.findUnique({ where: { id } });
  if (!r) notFound();
  const [products, locations, stock, currency, held] = await Promise.all([getPickerProducts(), getActiveLocations(), getStockByLocation(), getCurrency(), getResellerProducts(db, id)]);
  const prices = Object.fromEntries(held.map((p) => [p.productId, p.basePrice.toString()]));
  return (
    <>
      <PageHeader title={`What ${r.name} sold`} back={{ href: `/resellers/${id}`, label: r.name }} description="Enter what the reseller says they sold. The goods are taken from their stock and invoiced to them at the prices agreed when the stock was issued." />
      <ResellerStockForm
        variant="sold"
        action={reportSoldAction}
        resellerId={id}
        products={products}
        stockByLocation={{ reseller: stock[r.locationId] ?? {} }}
        prices={prices}
        locations={locations}
        submissionKey={randomUUID()}
        symbol={currency.symbol}
        canPrice={can(user, "sales.discount")}
        cancelHref={`/resellers/${id}`}
      />
    </>
  );
}
