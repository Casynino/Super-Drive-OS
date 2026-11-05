import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import ReturnForm, { type ReturnItem } from "@/components/sales/ReturnForm";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { returnedBySaleItem } from "@/lib/sales/reversals";
import { getCurrency } from "@/lib/settings";
import { requestReversal } from "../../reversal-actions";

export const metadata = { title: "Return or cancel" };

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("returns.create");
  const { id } = await params;
  const sale = await db.sale.findUnique({ where: { id }, include: { items: { orderBy: { id: "asc" }, include: { product: { select: { name: true } }, enteredUnit: { select: { symbol: true } } } } } });
  if (!sale || (!can(user, "sales.view_all") && sale.salespersonId !== user.id)) notFound();
  if (sale.status !== "COMPLETED") redirect(`/sales/${id}`);

  const [currency, done] = await Promise.all([getCurrency(), returnedBySaleItem(db, sale.id, true)]);
  const items: ReturnItem[] = sale.items.map((i) => ({
    id: i.id,
    name: i.product.name,
    unit: i.enteredUnit.symbol,
    sold: i.enteredQty.toString(),
    soldQty: i.enteredQty.toString(),
    left: i.enteredQty.minus(done.qty.get(i.id) ?? 0).toString(),
    lineTotal: i.lineTotal.toString(),
  }));

  return (
    <>
      <PageHeader title={`Return or cancel · ${sale.saleNo}`} description="Nothing is deleted: the sale stays on record with a note of what came back." back={{ href: `/sales/${id}`, label: sale.saleNo }} />
      {items.every((i) => Number(i.left) <= 0) ? (
        <Alert kind="info">Everything on this sale is already returned or waiting for approval.</Alert>
      ) : (
        <ReturnForm
          action={requestReversal}
          saleId={sale.id}
          items={items}
          money={{ total: Number(sale.total), returned: Number(sale.returnedTotal), paid: Number(sale.amountPaid), refunded: Number(sale.refundedTotal) }}
          currency={{ symbol: currency.symbol, decimals: currency.decimals }}
          canApproveNow={can(user, "returns.approve")}
          submissionKey={randomUUID()}
          cancelHref={`/sales/${id}`}
        />
      )}
    </>
  );
}
