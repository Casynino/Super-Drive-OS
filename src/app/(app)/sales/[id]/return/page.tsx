import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import ReturnForm, { type ReturnItem } from "@/components/sales/ReturnForm";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { returnedBySaleItem } from "@/lib/sales/reversals";
import { getCurrency, getReturnsNeedApproval } from "@/lib/settings";
import { requestReversal } from "../../reversal-actions";

export const metadata = { title: "Return or cancel" };

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("returns.create");
  const { id } = await params;
  const sale = await db.sale.findUnique({ where: { id }, include: { items: { orderBy: { id: "asc" }, include: { product: { select: { name: true } }, enteredUnit: { select: { symbol: true } } } } } });
  if (!sale || (!can(user, "sales.view_all") && sale.salespersonId !== user.id)) notFound();
  if (sale.status !== "COMPLETED") redirect(`/sales/${id}`);

  const [currency, done, needApproval, paid] = await Promise.all([
    getCurrency(),
    returnedBySaleItem(db, sale.id, true),
    getReturnsNeedApproval(),
    db.paymentAllocation.findMany({ where: { saleId: sale.id }, select: { amount: true, payment: { select: { method: true } } } }),
  ]);
  // the money goes back the way it came: the method that paid most of this sale
  const byMethod = new Map<string, number>();
  for (const a of paid) byMethod.set(a.payment.method, (byMethod.get(a.payment.method) ?? 0) + Number(a.amount));
  const defaultMethod = [...byMethod.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "CASH";
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
      <PageHeader title={`Return or cancel · ${sale.saleNo}`} description="Goods go back to the store and the money back to the customer. Nothing is deleted: the sale stays on record with the reason." back={{ href: `/sales/${id}`, label: sale.saleNo }} />
      {items.every((i) => Number(i.left) <= 0) ? (
        <Alert kind="info">Everything on this sale is already returned or waiting for approval.</Alert>
      ) : (
        <ReturnForm
          action={requestReversal}
          saleId={sale.id}
          items={items}
          money={{ total: Number(sale.total), returned: Number(sale.returnedTotal), paid: Number(sale.amountPaid), refunded: Number(sale.refundedTotal) }}
          currency={{ symbol: currency.symbol, decimals: currency.decimals }}
          canApproveNow={can(user, "returns.approve") || !needApproval}
          defaultMethod={defaultMethod}
          submissionKey={randomUUID()}
          cancelHref={`/sales/${id}`}
        />
      )}
    </>
  );
}
