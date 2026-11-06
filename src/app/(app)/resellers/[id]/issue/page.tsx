import { notFound, redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { PageHeader } from "@/components/ui";
import ResellerStockForm from "@/components/resellers/ResellerStockForm";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getCurrency } from "@/lib/settings";
import { getActiveLocations, getPickerProducts, getStockByLocation } from "../../../inventory/data";
import { issueStockAction } from "../../actions";

export const metadata = { title: "Issue stock to winga" };

export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("resellers.operate");
  const { id } = await params;
  const r = await db.reseller.findUnique({ where: { id } });
  if (!r) notFound();
  if (r.status !== "ACTIVE") redirect(`/resellers/${id}`);
  const [products, locations, stock, currency, priced] = await Promise.all([
    getPickerProducts(),
    getActiveLocations(),
    getStockByLocation(),
    getCurrency(),
    db.product.findMany({ where: { status: "ACTIVE" }, select: { id: true, sellingPrice: true, wholesalePrice: true } }),
  ]);
  const prices = Object.fromEntries(priced.map((p) => [p.id, (p.wholesalePrice ?? p.sellingPrice).toString()]));
  return (
    <>
      <PageHeader title={`Issue stock to ${r.name}`} back={{ href: `/resellers/${id}`, label: r.name }} description="The stock leaves the shop shelf and is held in this winga's name. It is not a sale: the winga only owes money for what they report sold." />
      <ResellerStockForm variant="issue" action={issueStockAction} resellerId={id} products={products} stockByLocation={stock} prices={prices} locations={locations} submissionKey={randomUUID()} symbol={currency.symbol} cancelHref={`/resellers/${id}`} />
    </>
  );
}
