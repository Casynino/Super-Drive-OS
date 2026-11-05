import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { PageHeader } from "@/components/ui";
import ResellerStockForm from "@/components/resellers/ResellerStockForm";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getCurrency } from "@/lib/settings";
import { getActiveLocations, getPickerProducts, getStockByLocation } from "../../../inventory/data";
import { returnStockAction } from "../../actions";

export const metadata = { title: "Reseller returns" };

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("resellers.operate");
  const { id } = await params;
  const r = await db.reseller.findUnique({ where: { id } });
  if (!r) notFound();
  const [products, locations, stock, currency] = await Promise.all([getPickerProducts(), getActiveLocations(), getStockByLocation(), getCurrency()]);
  return (
    <>
      <PageHeader title={`Stock coming back from ${r.name}`} back={{ href: `/resellers/${id}`, label: r.name }} description="Goods that can be sold again go back on the shelf. Damaged goods are written off. Neither one is a sale or a payment." />
      <ResellerStockForm variant="return" action={returnStockAction} resellerId={id} products={products} stockByLocation={{ reseller: stock[r.locationId] ?? {} }} prices={{}} locations={locations} submissionKey={randomUUID()} symbol={currency.symbol} cancelHref={`/resellers/${id}`} />
    </>
  );
}
